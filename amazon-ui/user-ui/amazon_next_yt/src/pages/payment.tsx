"use client";

import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  Shield,
  ChevronDown,
  Wallet,
  ExternalLink,
  MapPin,
  Clock,
  CreditCard,
  Smartphone,
  Building2,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { StateProps, StoreProduct } from "../../../type"; // Adjusted path
import FormattedPrice from "../components/FormattedPrice"; // Import FormattedPrice

// Extend Window interface for MetaMask
declare global {
  interface Window {
    ethereum?: any;
  }
}

type PaymentStep =
  | "selection"
  | "processing"
  | "aegis-redirect"
  | "aegis-processing"
  | "success"
  | "error";

interface WalletState {
  isConnected: boolean;
  address: string;
  balance: string;
  isConnecting: boolean;
}

interface UserLocationState {
  latitude: number | null;
  longitude: number | null;
  error: string | null;
  status: "idle" | "loading" | "success" | "error";
}

function RenderPayment() {
  const router = useRouter();
  // const { total } = router.query; // We'll use totalAmount from Redux store now
  // const totalValue = total ? parseFloat(total as string) : 0;

  const { productData } = useSelector((state: StateProps) => state.next);
  const [totalAmount, setTotalAmount] = useState(0);

  useEffect(() => {
    let amt = 0;
    productData.forEach((item: StoreProduct) => {
      amt += item.price * item.quantity;
    });
    setTotalAmount(amt);
  }, [productData]);

  const totalValue = totalAmount; // Use the state variable

  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    address: "",
    balance: "",
    isConnecting: false,
  });

  const paymentMethods = [
    {
      id: "phonepe",
      name: "PhonePe",
      icon: "/phonepe.svg",
      type: "image",
      category: "upi",
      description: "Pay with PhonePe UPI",
      popular: true
    },
    {
      id: "googlepay",
      name: "Google Pay",
      icon: "/gpay.svg",
      type: "image",
      category: "upi",
      description: "Pay with Google Pay UPI",
      popular: true
    },
    {
      id: "paytm",
      name: "Paytm",
      icon: "/paytm.svg",
      type: "image",
      category: "wallet",
      description: "Pay with Paytm Wallet",
      popular: false
    },
    {
      id: "card",
      name: "Credit/Debit Card",
      icon: "💳",
      type: "emoji",
      category: "card",
      description: "Visa, MasterCard, RuPay & more",
      popular: true
    },
    {
      id: "netbanking",
      name: "Net Banking",
      icon: "🏦",
      type: "emoji",
      category: "banking",
      description: "Pay directly from your bank",
      popular: false
    },
  ];

  const banks = [
    {
      id: "sbi",
      name: "State Bank of India",
      icon: "/sbi.svg",
      apiName: "SBI",
    },
    {
      id: "icici",
      name: "ICICI Bank",
      icon: "/icici.svg",
      apiName: "ICICI Bank",
    },
    { id: "axis", name: "Axis Bank", icon: "/axis.svg", apiName: "Axis Bank" },
    {
      id: "hdfc",
      name: "HDFC Bank",
      icon: "/hdfc.svg", // Assuming a generic icon path
      apiName: "HDFC Bank",
    },
    {
      id: "kotak",
      name: "Kotak Mahindra Bank",
      icon: "/kotak.svg", // Assuming a generic icon path
      apiName: "Kotak Mahindra Bank",
    },
  ];

  const aegisSteps = [
    {
      message: "Initiating payment through QuestPay...",
      duration: 2000,
    },
    {
      message: "Checking user eligibility for blockchain payment...",
      duration: 2500,
    },
    { message: "User verified ✓ Eligible for QuestPay", duration: 1500 },
    { message: "Scanning for nearest liquidity pools...", duration: 2000 },
    {
      message: "Pool found! Connecting to decentralized network...",
      duration: 2000,
    },
    {
      message: "Processing transaction on blockchain...",
      duration: 3000,
    },
    { message: "Transaction validated ✓", duration: 1500 },
    { message: "Payment completed successfully!", duration: 1000 },
  ];

  const [paymentStep, setPaymentStep] = useState<PaymentStep>("selection");
  const [currentAegisStep, setCurrentAegisStep] = useState(0);
  const [aegisMessage, setAegisMessage] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("");
  const [showBankDropdown, setShowBankDropdown] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [userLocation, setUserLocation] = useState<UserLocationState>({
    latitude: null,
    longitude: null,
    error: null,
    status: "idle",
  });

  // Geolocation Capture Function
  const captureUserLocation = () => {
    if (navigator.geolocation) {
      setUserLocation((prev) => ({ ...prev, status: "loading", error: null }));
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            error: null,
            status: "success",
          });
          console.log("Geolocation captured:", position.coords);
        },
        (error) => {
          let errorMessage = "An unknown error occurred.";
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Geolocation permission denied.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Location information is unavailable.";
              break;
            case error.TIMEOUT:
              errorMessage = "The request to get user location timed out.";
              break;
          }
          setUserLocation({
            latitude: null,
            longitude: null,
            error: errorMessage,
            status: "error",
          });
          console.error("Error capturing geolocation:", errorMessage);
        }
      );
    } else {
      setUserLocation({
        latitude: null,
        longitude: null,
        error: "Geolocation is not supported by this browser.",
        status: "error",
      });
      console.log("Geolocation not supported by browser.");
    }
  };

  const initiatePaymentProcessing = async (method: string, bankId?: string) => {
    const selectedBankName = bankId ? banks.find((b) => b.id === bankId)?.name : "your selected method";
    const confirmationMessage = `You are about to pay ${formatPrice(totalValue)} using ${selectedBankName}. Proceed?`;

    if (window.confirm(confirmationMessage)) {
      await handlePayment(method, bankId);
    } else {
      console.log("Payment cancelled by user.");
      // Optionally reset any state if needed, e.g., selected payment method
      setSelectedPaymentMethod("");
      setSelectedBank("");
    }
  };

  // Check if MetaMask is installed
  const isMetaMaskInstalled = () => {
    return typeof window !== "undefined" && Boolean(window.ethereum);
  };

  // Check wallet connection and capture location on component mount
  useEffect(() => {
    checkWalletConnection();
    captureUserLocation();

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", () => {
        window.location.reload();
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener(
          "accountsChanged",
          handleAccountsChanged
        );
      }
    };
  }, []);

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      setWalletState({
        isConnected: false,
        address: "",
        balance: "",
        isConnecting: false,
      });
    } else {
      setWalletState((prev) => ({
        ...prev,
        address: accounts[0],
      }));
      getWalletBalance(accounts[0]);
    }
  };

  const checkWalletConnection = async () => {
    if (!isMetaMaskInstalled()) return;

    try {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });

      if (accounts.length > 0) {
        setWalletState((prev) => ({
          ...prev,
          isConnected: true,
          address: accounts[0],
        }));
        getWalletBalance(accounts[0]);
      }
    } catch (error) {
      console.error("Error checking wallet connection:", error);
    }
  };

  const getWalletBalance = async (address: string) => {
    try {
      const balance = await window.ethereum.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      });

      const balanceInEth = parseInt(balance, 16) / Math.pow(10, 18);
      setWalletState((prev) => ({
        ...prev,
        balance: balanceInEth.toFixed(4),
      }));
    } catch (error) {
      console.error("Error getting wallet balance:", error);
    }
  };

  const connectWallet = async () => {
    if (!isMetaMaskInstalled()) {
      alert("MetaMask is not installed. Please install MetaMask to continue.");
      window.open("https://metamask.io/download/", "_blank");
      return;
    }

    setWalletState((prev) => ({ ...prev, isConnecting: true }));

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        setWalletState((prev) => ({
          ...prev,
          isConnected: true,
          address: accounts[0],
          isConnecting: false,
        }));
        getWalletBalance(accounts[0]);
      }
    } catch (error: any) {
      console.error("Error connecting wallet:", error);
      setWalletState((prev) => ({ ...prev, isConnecting: false }));

      if (error.code === 4001) {
        alert("Please connect to MetaMask to use blockchain payment features.");
      } else {
        alert("Error connecting to wallet. Please try again.");
      }
    }
  };

  const disconnectWallet = () => {
    setWalletState({
      isConnected: false,
      address: "",
      balance: "",
      isConnecting: false,
    });
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const handlePayment = async (method: string, bankId?: string) => {
    if (!walletState.isConnected) {
      const shouldConnect = confirm(
        "To ensure secure payment processing, please connect your MetaMask wallet. Connect now?"
      );

      if (shouldConnect) {
        await connectWallet();
        if (!walletState.isConnected) {
          return;
        }
      } else {
        return;
      }
    }

    setSelectedPaymentMethod(method);
    if (bankId) {
      setSelectedBank(bankId);
    }
    setPaymentStep("processing");

    const merchantId = "0xae6fE3971850928c94C8638cC1E83dA4F155cB47";
    const primaryFallbackPoolId = "0x622af06836555bd159a54555f3b0cdeb0a5fbfda";

    let capturedUserGeoLocation: { latitude: number; longitude: number } | null = null;
    if (userLocation.status === "success" && userLocation.latitude && userLocation.longitude) {
      capturedUserGeoLocation = {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      };
    }

    const paymentDetails = {
      userId: walletState.address || "anonymous_user",
      merchantId: merchantId,
      amount: totalValue,
      selectedBank: bankId ? banks.find((b) => b.id === bankId)?.apiName : null,
      userGeoLocation: capturedUserGeoLocation,
      primaryFallbackPoolId: primaryFallbackPoolId,
    };

    try {
      console.log("Initiating payment:", paymentDetails);
      const response = await fetch("http://localhost:8000/initiatePayment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentDetails),
      });

      const result = await response.json();

      if (response.ok) {
        console.log("Payment initiated successfully:", result);
        alert(`Payment initiated. Transaction ID: ${result.transaction_id}.`);

        setPaymentStep("aegis-redirect");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setPaymentStep("aegis-processing");
        for (let i = 0; i < aegisSteps.length; i++) {
          setCurrentAegisStep(i);
          setAegisMessage(aegisSteps[i].message);
          await new Promise((resolve) => setTimeout(resolve, aegisSteps[i].duration));
        }
        setPaymentStep("success");
      } else {
        console.error("Failed to initiate payment:", result);
        alert(`Error: ${result.detail || "Payment initiation failed."}`);
        setPaymentStep("error");
      }
    } catch (error) {
      console.error("Network or other error during payment:", error);
      alert("Failed to connect to payment service. Please try again later.");
      setPaymentStep("error");
    }
  };

  const handleBankSelection = (bankId: string) => {
    setSelectedBank(bankId);
    setShowBankDropdown(false);
    // Call initiatePaymentProcessing instead of handlePayment directly
    initiatePaymentProcessing("netbanking", bankId);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "upi":
        return <Smartphone className="w-5 h-5" />;
      case "card":
        return <CreditCard className="w-5 h-5" />;
      case "banking":
        return <Building2 className="w-5 h-5" />;
      default:
        return <Wallet className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Amazon-style Header */}
      <div className="bg-gray-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.back()}
                className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm">Back</span>
              </button>
              <div className="h-6 w-px bg-gray-600"></div>
              <div>
                <h1 className="text-xl font-medium">Select a payment method</h1>
                <p className="text-sm text-gray-300">Choose how you'd like to pay</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {walletState.isConnected ? (
                <div className="flex items-center space-x-3 bg-green-700 px-4 py-2 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <Wallet className="w-4 h-4 text-green-300" />
                    <div className="text-sm">
                      <div className="font-medium">{formatAddress(walletState.address)}</div>
                      {walletState.balance && (
                        <div className="text-xs text-green-200">{walletState.balance} ETH</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={disconnectWallet}
                    className="text-green-300 hover:text-white ml-2 transition-colors text-lg"
                    title="Disconnect wallet"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectWallet}
                  disabled={walletState.isConnecting}
                  className="flex items-center space-x-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {walletState.isConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wallet className="w-4 h-4" />
                  )}
                  <span>
                    {walletState.isConnecting ? "Connecting..." : "Connect Wallet"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Location Status */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
          <div className="flex items-center space-x-3">
            <MapPin className={`w-5 h-5 ${
              userLocation.status === "success" ? "text-green-600" :
              userLocation.status === "loading" ? "text-blue-600" :
              userLocation.status === "error" ? "text-red-600" : "text-gray-400"
            }`} />
            <div className="flex-1">
              {userLocation.status === "loading" && (
                <div className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="text-sm text-blue-700 font-medium">Fetching location...</span>
                </div>
              )}
              {userLocation.status === "success" && userLocation.latitude && (
                <div className="text-sm">
                  <span className="text-green-700 font-medium">✓ Location verified</span>
                  <span className="text-gray-500 ml-2">
                    {userLocation.latitude.toFixed(4)}, {userLocation.longitude?.toFixed(4)}
                  </span>
                </div>
              )}
              {userLocation.status === "error" && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-red-600">{userLocation.error}</span>
                  {userLocation.error?.includes("permission denied") && (
                    <button
                      onClick={captureUserLocation}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
              {userLocation.status === "idle" && (
                <span className="text-sm text-gray-500">Initializing location services...</span>
              )}
            </div>
          </div>
        </div>

        {/* MetaMask Installation Notice */}
        {!isMetaMaskInstalled() && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Wallet className="w-6 h-6 text-yellow-600" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-yellow-800 mb-2">
                  Enhance Your Security
                </h3>
                <p className="text-yellow-700 mb-4">
                  Install MetaMask to enable secure blockchain payments and enhanced transaction security.
                </p>
                <button
                  onClick={() =>
                    window.open("https://metamask.io/download/", "_blank")
                  }
                  className="inline-flex items-center space-x-2 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  <span>Install MetaMask</span>
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Order Summary */}
          <div className="lg:col-span-1 space-y-6">
            {/* Products */}
            {productData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                <h2 className="text-lg font-medium mb-4 text-gray-900">Order Summary</h2>
                <div className="space-y-4">
                  {productData.map((item: StoreProduct) => (
                    <div
                      key={item._id}
                      className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-white shadow-sm">
                        <Image
                          src={item.image}
                          alt={item.title}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 truncate">
                          {item.title}
                        </h3>
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      </div>
                      <div className="text-sm font-medium text-gray-900">
                        <FormattedPrice amount={item.price * item.quantity} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <span className="text-lg font-medium text-gray-900">Order Total</span>
                <span className="text-2xl font-bold text-red-600">
                  <FormattedPrice amount={totalValue} />
                </span>
              </div>
              <div className="text-xs text-gray-500 flex items-center space-x-1">
                <Shield className="w-3 h-3" />
                <span>Secure checkout with 256-bit SSL encryption</span>
              </div>
            </div>
          </div>

          {/* Payment Section */}
          <div className="lg:col-span-2">
            {paymentStep === "selection" && (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-xl font-medium text-gray-900">Choose a payment method</h2>
                  <p className="text-sm text-gray-600 mt-1">We accept all major payment methods</p>
                </div>

                <div className="p-6">
                  {/* Popular Methods */}
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
                      <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded-full mr-2">Popular</span>
                      Most used payment methods
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {paymentMethods.filter(method => method.popular).map((method) => (
                        <div key={method.id}>
                          {method.id === "netbanking" ? (
                            <div className="border border-gray-200 rounded-lg overflow-hidden hover:border-orange-300 transition-colors">
                              <button
                                onClick={() => setShowBankDropdown(!showBankDropdown)}
                                className="w-full flex items-center justify-between p-4 hover:bg-orange-50 transition-colors text-left"
                              >
                                <div className="flex items-center space-x-3">
                                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                    {getCategoryIcon(method.category)}
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-900">{method.name}</div>
                                    <div className="text-xs text-gray-500">{method.description}</div>
                                  </div>
                                </div>
                                <ChevronDown
                                  className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ${
                                    showBankDropdown ? "rotate-180" : ""
                                  }`}
                                />
                              </button>
                              {showBankDropdown && (
                                <div className="border-t border-gray-200 bg-gray-50">
                                  <div className="p-2 space-y-1">
                                    {banks.map((bank) => (
                                      <button
                                        key={bank.id}
                                        onClick={() => handleBankSelection(bank.id)}
                                        className="w-full flex items-center space-x-3 p-3 hover:bg-white hover:shadow-sm transition-all duration-150 text-left rounded-lg"
                                      >
                                        <div className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center">
                                          <Image
                                            src={bank.icon}
                                            alt={bank.name}
                                            width={24}
                                            height={24}
                                            className="object-contain"
                                          />
                                        </div>
                                        <span className="font-medium text-gray-700">{bank.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => initiatePaymentProcessing(method.id)}
                              className="w-full flex items-center space-x-3 p-4 border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-all duration-200 text-left"
                            >
                              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                {method.type === "image" ? (
                                  <Image
                                    src={method.icon}
                                    alt={method.name}
                                    width={24}
                                    height={24}
                                    className="object-contain"
                                  />
                                ) : (
                                  <span className="text-xl">{method.icon}</span>
                                )}
                              </div>
                              <div>
                                <div className="font-medium text-gray-900">{method.name}</div>
                                <div className="text-xs text-gray-500">{method.description}</div>
                              </div>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Other Methods */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Other payment methods</h3>
                    <div className="space-y-2">
                      {paymentMethods.filter(method => !method.popular).map((method) => (
                        <div key={method.id}>
                          {method.id === "netbanking" ? (
                            <div className="border border-gray-200 rounded-lg overflow-hidden hover:border-orange-300 transition-colors">
                              <button
                                onClick={() => setShowBankDropdown(!showBankDropdown)}
                                className="w-full flex items-center justify-between p-4 hover:bg-orange-50 transition-colors text-left"
                              >
                                <div className="flex items-center space-x-3">
                                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                    {getCategoryIcon(method.category)}
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-900">{method.name}</div>
                                    <div className="text-xs text-gray-500">{method.description}</div>
                                  </div>
                                </div>
                                <ChevronDown
                                  className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ${
                                    showBankDropdown ? "rotate-180" : ""
                                  }`}
                                />
                              </button>
                              {showBankDropdown && (
                                <div className="border-t border-gray-200 bg-gray-50">
                                  <div className="p-2 space-y-1">
                                    {banks.map((bank) => (
                                      <button
                                        key={bank.id}
                                        onClick={() => handleBankSelection(bank.id)}
                                        className="w-full flex items-center space-x-3 p-3 hover:bg-white hover:shadow-sm transition-all duration-150 text-left rounded-lg"
                                      >
                                        <div className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center">
                                          <Image
                                            src={bank.icon}
                                            alt={bank.name}
                                            width={24}
                                            height={24}
                                            className="object-contain"
                                          />
                                        </div>
                                        <span className="font-medium text-gray-700">{bank.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => initiatePaymentProcessing(method.id)}
                              className="w-full flex items-center space-x-3 p-4 border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-all duration-200 text-left"
                            >
                              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                {method.type === "image" ? (
                                  <Image
                                    src={method.icon}
                                    alt={method.name}
                                    width={24}
                                    height={24}
                                    className="object-contain"
                                  />
                                ) : (
                                  <span className="text-xl">{method.icon}</span>
                                )}
                              </div>
                              <div>
                                <div className="font-medium text-gray-900">{method.name}</div>
                                <div className="text-xs text-gray-500">{method.description}</div>
                              </div>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {paymentStep === "processing" && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                </div>
                <h3 className="text-xl font-medium mb-3 text-gray-900">Processing Payment</h3>
                <p className="text-gray-600 mb-4">
                  {selectedPaymentMethod === "netbanking" && selectedBank ? (
                    <>
                      Connecting to {banks.find((b) => b.id === selectedBank)?.name}...
                    </>
                  ) : (
                    <>
                      Connecting to{" "}
                      {
                        paymentMethods.find((m) => m.id === selectedPaymentMethod)
                          ?.name
                      }
                      ...
                    </>
                  )}
                </p>
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                  <Clock className="w-4 h-4" />
                  <span>This may take a moment</span>
                </div>
              </div>
            )}

            {paymentStep === "aegis-redirect" && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-medium mb-3 text-gray-900">QuestPay Activated</h3>
                <p className="text-gray-600 mb-6">
                  Processing your payment through our secure blockchain system.
                </p>
                {walletState.isConnected && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-center space-x-2 text-sm text-green-700">
                      <CheckCircle className="w-4 h-4" />
                      <span>Wallet connected: {formatAddress(walletState.address)}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-center space-x-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span className="text-gray-600">Initializing secure payment...</span>
                </div>
              </div>
            )}

            {paymentStep === "aegis-processing" && (
              <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-medium text-gray-900 mb-2">QuestPay Processing</h3>
                  <p className="text-gray-600">Secure blockchain payment in progress</p>
                  {walletState.isConnected && (
                    <div className="mt-3 inline-flex items-center text-xs text-green-600 bg-green-100 px-3 py-1 rounded-full">
                      <Wallet className="w-3 h-3 mr-1" />
                      Connected: {formatAddress(walletState.address)}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {aegisSteps.map((step, index) => (
                    <div
                      key={index}
                      className={`flex items-center p-4 rounded-lg transition-all duration-500 ${
                        index < currentAegisStep
                          ? "bg-green-50 border border-green-200"
                          : index === currentAegisStep
                          ? "bg-blue-50 border border-blue-200"
                          : "bg-gray-50 border border-gray-200"
                      }`}
                    >
                      {index < currentAegisStep ? (
                        <CheckCircle className="w-5 h-5 text-green-600 mr-3 flex-shrink-0" />
                      ) : index === currentAegisStep ? (
                        <Loader2 className="w-5 h-5 animate-spin text-blue-600 mr-3 flex-shrink-0" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-300 mr-3 flex-shrink-0" />
                      )}
                      <span
                        className={`text-sm ${
                          index <= currentAegisStep
                            ? "text-gray-800 font-medium"
                            : "text-gray-500"
                        }`}
                      >
                        {step.message}
                      </span>
                    </div>
                  ))}
                </div>

                {aegisMessage && (
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-blue-800 font-medium text-center text-sm">
                      {aegisMessage}
                    </p>
                  </div>
                )}
              </div>
            )}

            {paymentStep === "success" && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-12 h-12 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-green-600">
                  Order Placed Successfully!
                </h3>
                <p className="text-gray-600 mb-2 text-lg">
                  Your order has been confirmed and will be processed soon.
                </p>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-green-700">
                    {selectedPaymentMethod === "netbanking" && selectedBank
                      ? "Transaction completed successfully"
                      : walletState.isConnected
                      ? `Transaction processed via QuestPay - Secured with wallet ${formatAddress(
                          walletState.address
                        )}`
                      : "Transaction processed via QuestPay"}
                  </p>
                </div>
                <div className="text-xs text-gray-500 mb-6">
                  Transaction ID: #{Math.random().toString(36).substr(2, 9).toUpperCase()}
                </div>
                <button
                  onClick={() => router.push('/')}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3 px-8 rounded-lg font-medium transition-colors"
                >
                  Continue Shopping
                </button>
              </div>
            )}

            {paymentStep === "error" && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-red-600 text-4xl font-bold">✕</span>
                </div>
                <h3 className="text-2xl font-bold mb-3 text-red-600">
                  Payment Failed
                </h3>
                <p className="text-gray-600 mb-6">
                  An error occurred while processing your payment. Please try again.
                </p>
                <button
                  onClick={() => setPaymentStep("selection")}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3 px-6 rounded-lg font-medium transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RenderPayment;
