import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  Shield,
  ChevronDown,
  Wallet,
  ExternalLink,
  CreditCard,
  Building2,
  Smartphone,
  MapPin,
  Lock,
  AlertCircle,
  Info,
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

<<<<<<< HEAD
interface PaymentInterfaceProps {
  total?: number;
}

function PaymentInterface({ total = 2499 }: PaymentInterfaceProps) {
  const totalValue = total;
=======
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
>>>>>>> 529851b706ca4705703c3dda682c9a9d7ae5cc40

  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    address: "",
    balance: "",
    isConnecting: false,
  });

  const paymentMethods = [
     { 
      id: "netbanking", 
      name: "Net Banking", 
      icon: Building2, 
      description: "All major banks supported"
    },
    { 
      id: "phonepe", 
      name: "PhonePe", 
      icon: Smartphone, 
      description: "Pay using PhonePe UPI"
    },
    { 
      id: "googlepay", 
      name: "Google Pay", 
      icon: Smartphone, 
      description: "Pay using Google Pay UPI"
    },
    { 
      id: "paytm", 
      name: "Paytm", 
      icon: Smartphone, 
      description: "Pay using Paytm wallet or UPI"
    },
    { 
      id: "card", 
      name: "Credit or debit card", 
      icon: CreditCard, 
      description: "Visa, Mastercard, American Express and more"
    },
   
  ];

  const banks = [
    {
      id: "sbi",
      name: "State Bank of India",
      apiName: "SBI",
    },
    {
      id: "icici",
      name: "ICICI Bank", 
      apiName: "ICICI Bank",
    },
    { 
      id: "axis", 
      name: "Axis Bank", 
      apiName: "Axis Bank",
    },
    {
      id: "hdfc",
      name: "HDFC Bank",
      apiName: "HDFC Bank",
    },
    {
      id: "kotak",
      name: "Kotak Mahindra Bank",
      apiName: "Kotak Mahindra Bank",
    },
  ];

  const aegisSteps = [
    {
      message: "Initiating payment through AegisPay...",
      duration: 2000,
    },
    {
      message: "Checking user eligibility for blockchain payment...",
      duration: 2500,
    },
    { message: "User verified ✓ Eligible for AegisPay", duration: 1500 },
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
    const primaryFallbackPoolId = "0x6e26fDC11bFf75C63dF692e08cdC7180dFCAea19";

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
    initiatePaymentProcessing("netbanking", bankId);
  };

  return (
    <div className="min-h-screen bg-gray-100">
<<<<<<< HEAD
      {/* Amazon-style Header */}
      <div className="bg-[#232f3e] text-white">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="h-6 w-px bg-gray-500"></div>
              <h1 className="text-lg font-medium">Checkout</h1>
            </div>
            <div className="flex items-center space-x-3">
              {walletState.isConnected ? (
                <div className="flex items-center space-x-2 bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded text-sm font-medium transition-colors">
                  <div className="w-2 h-2 bg-green-300 rounded-full"></div>
                  <Wallet className="w-4 h-4" />
                  <span>{formatAddress(walletState.address)}</span>
                  <button
                    onClick={disconnectWallet}
                    className="text-green-200 hover:text-white ml-1 text-lg leading-none"
                    title="Disconnect wallet"
                  >
                    ×
                  </button>
                </div>
=======
      <div className="bg-amazon_light text-white p-4 flex items-center justify-between">
        <h1 className="text-xl font-medium">Select a payment method</h1>
        <div className="flex items-center space-x-2">
          {walletState.isConnected ? (
            <div className="flex items-center space-x-2 bg-green-600 px-3 py-1 rounded-full text-sm">
              <Wallet className="w-4 h-4" />
              <span>{formatAddress(walletState.address)}</span>
              <button
                onClick={disconnectWallet}
                className="text-green-200 hover:text-white ml-1"
                title="Disconnect wallet"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={walletState.isConnecting}
              className="flex items-center space-x-2 bg-amazon_yellow hover:bg-yellow-500 text-black px-3 py-1 rounded-full text-sm transition-colors disabled:opacity-50"
            >
              {walletState.isConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-700" />
>>>>>>> 529851b706ca4705703c3dda682c9a9d7ae5cc40
              ) : (
                <button
                  onClick={connectWallet}
                  disabled={walletState.isConnecting}
                  className="flex items-center space-x-2 bg-[#ff9900] hover:bg-[#e88b00] px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
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

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Location Status */}
            <div className="bg-white border border-gray-300 rounded-lg">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <h3 className="text-sm font-medium text-gray-900 flex items-center">
                  <MapPin className="w-4 h-4 mr-2" />
                  Location Services
                </h3>
              </div>
              <div className="p-4">
                <div className="flex items-start space-x-3">
                  <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
                    userLocation.status === "success" ? "bg-green-100" :
                    userLocation.status === "loading" ? "bg-blue-100" :
                    userLocation.status === "error" ? "bg-red-100" : "bg-gray-100"
                  }`}>
                    {userLocation.status === "loading" ? (
                      <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                    ) : userLocation.status === "success" ? (
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                    ) : userLocation.status === "error" ? (
                      <div className="w-2 h-2 bg-red-600 rounded-full"></div>
                    ) : (
                      <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    {userLocation.status === "loading" && (
                      <p className="text-sm text-blue-700">Detecting your location for secure payment processing...</p>
                    )}
                    {userLocation.status === "success" && userLocation.latitude && (
                      <div>
                        <p className="text-sm text-green-700 font-medium">Location detected successfully</p>
                        <p className="text-xs text-gray-600 mt-1">
                          Coordinates: {userLocation.latitude.toFixed(4)}, {userLocation.longitude?.toFixed(4)}
                        </p>
                      </div>
                    )}
                    {userLocation.status === "error" && (
                      <div>
                        <p className="text-sm text-red-700 font-medium">Location access required</p>
                        <p className="text-xs text-gray-600 mt-1">{userLocation.error}</p>
                        {userLocation.error?.includes("permission denied") && (
                          <button
                            onClick={captureUserLocation}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-2 underline"
                          >
                            Enable location access
                          </button>
                        )}
                      </div>
                    )}
                    {userLocation.status === "idle" && (
                      <p className="text-sm text-gray-600">Initializing location services...</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Wallet Status */}
            {walletState.isConnected && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-sm font-medium text-gray-900 flex items-center">
                    <Shield className="w-4 h-4 mr-2" />
                    Blockchain Security
                  </h3>
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">MetaMask Wallet Connected</p>
                        <p className="text-xs text-gray-600 font-mono">
                          {formatAddress(walletState.address)}
                        </p>
                        {walletState.balance && (
                          <p className="text-xs text-gray-600">
                            Balance: {walletState.balance} ETH
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="w-3 h-3 bg-green-500 rounded-full mx-auto"></div>
                      <p className="text-xs text-green-600 font-medium mt-1">SECURE</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MetaMask Installation Notice */}
            {!isMetaMaskInstalled() && (
              <div className="bg-white border border-orange-300 rounded-lg">
                <div className="px-4 py-3 border-b border-orange-200 bg-orange-50">
                  <h3 className="text-sm font-medium text-orange-900 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Enhanced Security Available
                  </h3>
                </div>
                <div className="p-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Wallet className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700 mb-3">
                        Install MetaMask to enable advanced blockchain payment security features for this transaction.
                      </p>
                      <button
                        onClick={() =>
                          window.open("https://metamask.io/download/", "_blank")
                        }
                        className="inline-flex items-center text-sm bg-[#ff9900] hover:bg-[#e88b00] text-white px-3 py-1.5 rounded font-medium transition-colors"
                      >
                        Install MetaMask
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Methods Selection */}
            {paymentStep === "selection" && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-lg font-medium text-gray-900">Select a payment method</h3>
                </div>
                <div className="p-4 space-y-3">
                  {paymentMethods.map((method) => {
                    const IconComponent = method.icon;
                    return (
                      <div key={method.id}>
                        {method.id === "netbanking" ? (
                          <div className="border border-gray-300 rounded-lg overflow-hidden">
                            <button
                              onClick={() => setShowBankDropdown(!showBankDropdown)}
                              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                                  <IconComponent className="w-5 h-5 text-gray-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{method.name}</p>
                                  <p className="text-xs text-gray-600">{method.description}</p>
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
                                {banks.map((bank) => (
                                  <button
                                    key={bank.id}
                                    onClick={() => handleBankSelection(bank.id)}
                                    className="w-full flex items-center p-4 hover:bg-white transition-colors text-left border-b border-gray-100 last:border-b-0"
                                  >
                                    <div className="w-6 h-6 bg-white border border-gray-200 rounded flex items-center justify-center mr-3">
                                      <Building2 className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <span className="text-sm text-gray-900">{bank.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => initiatePaymentProcessing(method.id)}
                            className="w-full flex items-center p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left"
                          >
                            <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center mr-3">
                              <IconComponent className="w-5 h-5 text-gray-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{method.name}</p>
                              <p className="text-xs text-gray-600">{method.description}</p>
                            </div>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Processing State */}
            {paymentStep === "processing" && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="p-8 text-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Processing your payment</h3>
                  <p className="text-sm text-gray-600">
                    {selectedPaymentMethod === "netbanking" && selectedBank ? (
                      <>
                        Connecting to <span className="font-medium">{banks.find((b) => b.id === selectedBank)?.name}</span>...
                      </>
                    ) : (
                      <>
                        Connecting to <span className="font-medium">
                          {paymentMethods.find((m) => m.id === selectedPaymentMethod)?.name}
                        </span>...
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Aegis Redirect State */}
            {paymentStep === "aegis-redirect" && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="p-8 text-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">AegisPay Security Activated</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Your payment is being processed through our secure blockchain infrastructure.
                  </p>
                  {walletState.isConnected && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-green-700 flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Wallet secured: {formatAddress(walletState.address)}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin mr-2 text-blue-600" />
                    <span className="text-sm text-gray-600">Initializing secure payment protocol...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Aegis Processing State */}
            {paymentStep === "aegis-processing" && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-900 flex items-center">
                      <Shield className="w-4 h-4 mr-2" />
                      AegisPay Blockchain Processing
                    </h3>
                    {walletState.isConnected && (
                      <div className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                        <Wallet className="w-3 h-3 mr-1" />
                        {formatAddress(walletState.address)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <div className="space-y-3">
                    {aegisSteps.map((step, index) => (
                      <div
                        key={index}
                        className={`flex items-center p-3 rounded-lg transition-all duration-500 ${
                          index < currentAegisStep
                            ? "bg-green-50 border border-green-200"
                            : index === currentAegisStep
                            ? "bg-blue-50 border border-blue-200"
                            : "bg-gray-50 border border-gray-200"
                        }`}
                      >
                        {index < currentAegisStep ? (
                          <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                            <CheckCircle className="w-4 h-4 text-white" />
                          </div>
                        ) : index === currentAegisStep ? (
                          <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full border-2 border-gray-300 mr-3 flex-shrink-0" />
                        )}
                        <span
                          className={`text-sm ${
                            index <= currentAegisStep
                              ? "text-gray-900 font-medium"
                              : "text-gray-500"
                          }`}
                        >
                          {step.message}
                        </span>
                      </div>
                    ))}
                  </div>

                  {aegisMessage && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-blue-800 font-medium text-center text-sm">
                        {aegisMessage}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Success State */}
            {paymentStep === "success" && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-10 h-10 text-green-600" />
                  </div>
                  <h3 className="text-xl font-medium mb-2 text-green-600">
                    Order placed successfully
                  </h3>
                  <p className="text-sm text-gray-600 mb-2">
                    Your order has been confirmed and will be processed shortly.
                  </p>
                  <p className="text-xs text-gray-500 mb-6">
                    {selectedPaymentMethod === "netbanking" && selectedBank
                      ? "Payment completed via Net Banking"
                      : walletState.isConnected
                      ? `Secured transaction via AegisPay blockchain (${formatAddress(
                          walletState.address
                        )})`
                      : "Payment processed via AegisPay"}
                  </p>
                  <div className="inline-flex items-center bg-green-50 border border-green-200 px-4 py-2 rounded-lg">
                    <Lock className="w-4 h-4 text-green-600 mr-2" />
                    <span className="text-sm text-green-700 font-medium">Transaction Secured</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error State */}
            {paymentStep === "error" && (
              <div className="bg-white border border-gray-300 rounded-lg">
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-10 h-10 text-red-600" />
                  </div>
                  <h3 className="text-xl font-medium mb-2 text-red-600">
                    Payment failed
                  </h3>
                  <p className="text-sm text-gray-600 mb-6">
                    There was a problem processing your payment. Please try again or use a different payment method.
                  </p>
                  <button
                    onClick={() => setPaymentStep("selection")}
                    className="bg-[#ff9900] hover:bg-[#e88b00] text-white py-2 px-4 rounded font-medium transition-colors"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-gray-300 rounded-lg sticky top-6">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <h3 className="text-lg font-medium text-gray-900">Order Summary</h3>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Items:</span>
                    <span className="text-gray-900">{formatPrice(totalValue)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Delivery:</span>
                    <span className="text-green-600 font-medium">FREE</span>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <div className="flex justify-between">
                      <span className="text-lg font-medium text-gray-900">Order Total:</span>
                      <span className="text-lg font-bold text-red-600">{formatPrice(totalValue)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-blue-800 font-medium">AegisPay Protection</p>
                      <p className="text-xs text-blue-700 mt-1">
                        Your payment is secured with blockchain technology for enhanced security and transparency.
                      </p>
                    </div>
                  </div>
                </div>

                {paymentStep === "selection" && (
                  <div className="mt-4 text-xs text-gray-500">
                    <p>By placing your order, you agree to our terms and conditions.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
<<<<<<< HEAD
        </div>
=======
        )}

        {!isMetaMaskInstalled() && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Wallet className="w-5 h-5 text-yellow-600" />
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-yellow-800">
                  MetaMask Required
                </h3>
                <p className="text-sm text-yellow-700 mt-1">
                  Install MetaMask to enable secure blockchain payments.
                </p>
                <button
                  onClick={() =>
                    window.open("https://metamask.io/download/", "_blank")
                  }
                  className="mt-2 inline-flex items-center text-sm text-yellow-800 hover:text-yellow-900"
                >
                  Install MetaMask
                  <ExternalLink className="w-3 h-3 ml-1" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Product Details Section */}
        {productData.length > 0 && (
          <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
            <h2 className="text-lg font-medium mb-3">Items in your order</h2>
            <div className="space-y-3">
              {productData.map((item: StoreProduct) => (
                <div
                  key={item._id}
                  className="flex items-center space-x-3 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <Image
                    src={item.image}
                    alt={item.title}
                    width={60}
                    height={60}
                    className="rounded object-cover"
                  />
                  <div className="flex-grow">
                    <h3 className="text-sm font-medium text-gray-800">
                      {item.title}
                    </h3>
                    <p className="text-xs text-gray-500">
                      Qty: {item.quantity}
                    </p>
                  </div>
                  <div className="text-sm font-medium text-gray-800">
                    <FormattedPrice amount={item.price * item.quantity} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
          <h2 className="text-lg font-medium mb-3">Order Summary</h2>
          <div className="flex justify-between items-center text-lg">
            <span>Order Total:</span>
            <span className="font-bold">
              <FormattedPrice amount={totalValue} />
            </span>
          </div>
        </div>

        {paymentStep === "selection" && (
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-medium mb-4">
              Choose a payment method
            </h2>
            <div className="space-y-3">
              {paymentMethods.map((method) => (
                <div key={method.id}>
                  {method.id === "netbanking" ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setShowBankDropdown(!showBankDropdown)}
                        className="w-full flex items-center justify-between p-4 hover:border-amazon_yellow hover:bg-yellow-50 transition-colors text-left border border-gray-200 rounded-lg"
                      >
                        <div className="flex items-center">
                          <span className="text-2xl mr-4">{method.icon}</span>
                          <span className="font-medium">{method.name}</span>
                        </div>
                        <ChevronDown
                          className={`w-5 h-5 transform transition-transform duration-200 ${
                            showBankDropdown ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {showBankDropdown && (
                        <div className="border-t border-gray-200 bg-gray-50">
                          {banks.map((bank) => (
                            <button
                              key={bank.id}
                              onClick={() => handleBankSelection(bank.id)}
                              className="w-full flex items-center p-4 hover:bg-yellow-50 transition-colors text-left border-b border-gray-100 last:border-b-0"
                            >
                              <div className="w-8 h-8 mr-4 flex items-center justify-center">
                                <Image
                                  src={bank.icon}
                                  alt={bank.name}
                                  width={32}
                                  height={32}
                                  className="object-contain"
                                />
                              </div>
                              <span className="font-medium">{bank.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => initiatePaymentProcessing(method.id)} // Changed to initiatePaymentProcessing
                      className="w-full flex items-center p-4 border border-gray-200 rounded-lg hover:border-amazon_yellow hover:bg-yellow-50 transition-colors text-left"
                    >
                      {method.type === "image" ? (
                        <div className="w-8 h-8 mr-4 flex items-center justify-center">
                          <Image
                            src={method.icon}
                            alt={method.name}
                            width={32}
                            height={32}
                            className="object-contain"
                          />
                        </div>
                      ) : (
                        <span className="text-2xl mr-4">{method.icon}</span>
                      )}
                      <span className="font-medium">{method.name}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {paymentStep === "processing" && (
          <div className="bg-white rounded-lg p-8 text-center shadow-sm">
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-amazon_light" />
            <h3 className="text-lg font-medium mb-2">Processing Payment</h3>
            <p className="text-gray-600">
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
          </div>
        )}

        {paymentStep === "aegis-redirect" && (
          <div className="bg-white rounded-lg p-8 text-center shadow-sm">
            <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">QuestPay Activated</h3>
            <p className="text-gray-600 mb-4">
              Processing your payment through our secure blockchain system.
            </p>
            {walletState.isConnected && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-green-600">
                  ✓ Wallet connected: {formatAddress(walletState.address)}
                </p>
              </div>
            )}
            <div className="flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin mr-2 text-blue-600" />
              <span>Initializing secure payment...</span>
            </div>
          </div>
        )}

        {paymentStep === "aegis-processing" && (
          <div className="bg-white rounded-lg p-6 shadow-sm">
            <div className="text-center mb-6">
              <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium">QuestPay Processing</h3>
              <p className="text-sm text-gray-600">
                Secure blockchain payment in progress
              </p>
              {walletState.isConnected && (
                <div className="mt-2 inline-flex items-center text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                  <Wallet className="w-3 h-3 mr-1" />
                  Connected: {formatAddress(walletState.address)}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {aegisSteps.map((step, index) => (
                <div
                  key={index}
                  className={`flex items-center p-3 rounded-lg transition-all duration-500 ${
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
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-blue-800 font-medium text-center text-sm">
                  {aegisMessage}
                </p>
              </div>
            )}
          </div>
        )}

        {paymentStep === "success" && (
          <div className="bg-white rounded-lg p-8 text-center shadow-sm">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-2 text-green-600">
              Order Placed Successfully!
            </h3>
            <p className="text-gray-600 mb-2">
              Your order has been confirmed and will be processed soon.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              {selectedPaymentMethod === "netbanking" && selectedBank
                ? "Transaction completed successfully"
                : walletState.isConnected
                ? `Transaction processed via QuestPay - Secured with wallet ${formatAddress(
                    walletState.address
                  )}`
                : "Transaction processed via QuestPay"}
            </p>
          </div>
        )}

        {paymentStep === "error" && (
          <div className="bg-white rounded-lg p-8 text-center shadow-sm">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-red-600 text-3xl">✕</span>
            </div>
            <h3 className="text-xl font-bold mb-2 text-red-600">
              Payment Failed
            </h3>
            <p className="text-gray-600 mb-4">
              An error occurred while processing your payment. Please try again.
            </p>
            <button
              onClick={() => setPaymentStep("selection")}
              className="bg-amazon_yellow text-black py-2 px-4 rounded-lg hover:bg-yellow-500 transition-colors font-medium"
            >
              Try Again
            </button>
          </div>
        )}
>>>>>>> 529851b706ca4705703c3dda682c9a9d7ae5cc40
      </div>
    </div>
  );
}

export default PaymentInterface;