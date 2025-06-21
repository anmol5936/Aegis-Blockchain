"use client";

import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  Shield,
  ChevronDown,
  Wallet,
  ExternalLink,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/router";

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
  const { total } = router.query;
  const totalValue = total ? parseFloat(total as string) : 0;

  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    address: "",
    balance: "",
    isConnecting: false,
  });

  const paymentMethods = [
    { id: "phonepe", name: "PhonePe", icon: "/phonepe.svg", type: "image" },
    { id: "googlepay", name: "Google Pay", icon: "/gpay.svg", type: "image" },
    { id: "paytm", name: "Paytm", icon: "/paytm.svg", type: "image" },
    { id: "card", name: "Credit/Debit Card", icon: "💳", type: "emoji" },
    { id: "netbanking", name: "Net Banking", icon: "🏦", type: "emoji" },
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
    // Call initiatePaymentProcessing instead of handlePayment directly
    initiatePaymentProcessing("netbanking", bankId);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#232f3e] text-white p-4 flex items-center justify-between">
        <h1 className="text-lg font-medium">Select a payment method</h1>
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
              className="flex items-center space-x-2 bg-orange-600 hover:bg-orange-700 px-3 py-1 rounded-full text-sm transition-colors disabled:opacity-50"
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

      <div className="p-4">
        <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50 text-sm">
          {userLocation.status === "loading" && (
            <p className="text-blue-600">Fetching location...</p>
          )}
          {userLocation.status === "success" && userLocation.latitude && (
            <p className="text-green-600">
              Location captured: Lat: {userLocation.latitude.toFixed(4)}, Lon: {userLocation.longitude?.toFixed(4)}
            </p>
          )}
          {userLocation.status === "error" && (
            <div className="text-red-600">
              <p>Location Error: {userLocation.error}</p>
              {userLocation.error?.includes("permission denied") && (
                <button
                  onClick={captureUserLocation}
                  className="text-blue-500 hover:underline ml-2"
                >
                  Retry Location
                </button>
              )}
            </div>
          )}
          {userLocation.status === "idle" && (
            <p className="text-gray-600">Initializing location services...</p>
          )}
        </div>

        {walletState.isConnected && (
          <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-800 flex items-center">
                  <Wallet className="w-4 h-4 mr-2 text-green-600" />
                  Wallet Connected
                </h3>
                <p className="text-sm text-gray-600">
                  {formatAddress(walletState.address)}
                </p>
                {walletState.balance && (
                  <p className="text-sm text-gray-600">
                    Balance: {walletState.balance} ETH
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <p className="text-xs text-green-600 mt-1">Secure</p>
              </div>
            </div>
          </div>
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

        <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
          <h2 className="text-lg font-medium mb-3">Order Summary</h2>
          <div className="flex justify-between items-center text-lg">
            <span>Order Total:</span>
            <span className="font-bold">{formatPrice(totalValue)}</span>
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
                        className="w-full flex items-center justify-between p-4 hover:border-orange-500 hover:bg-orange-50 transition-colors text-left"
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
                              className="w-full flex items-center p-4 hover:bg-orange-50 transition-colors text-left border-b border-gray-100 last:border-b-0"
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
                      className="w-full flex items-center p-4 border border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-colors text-left"
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
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-orange-500" />
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
              className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RenderPayment;