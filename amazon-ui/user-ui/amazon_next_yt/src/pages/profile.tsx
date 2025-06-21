import React, { useEffect, useState, useContext } from "react";
// import { useSelector } from "react-redux"; // Not used for now
import { useStateContext } from "../../../../BlockchainContext"; // Adjusted path
import FormattedPrice from "../components/FormattedPrice"; // For displaying monetary values
// import { Wallet } from "lucide-react"; // Example icon, not used for now

interface ProfileData {
  totalDebt: number;
  totalCollateral: number;
  totalStakedValue: number; // Renamed from totalStakedReward
}

const ProfilePage = () => {
  const {
    address,
    fetchBlockchainPools,
    getUserStakeInfo,
    getTotalCollateralAcrossPools,
    signer, // Used to check if wallet is connected
  } = useStateContext();

  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfileData = async () => {
      if (!address || !signer) {
        setLoading(false); // Not connected or still initializing
        return;
      }

      setLoading(true);
      try {
        const pools = await fetchBlockchainPools();
        let calculatedTotalDebt = 0;
        let calculatedTotalStakedValue = 0;

        for (const pool of pools) {
          // Total Debt calculation
          if (pool.userDebt) {
            calculatedTotalDebt += pool.userDebt;
          }

          // Total Staked Value calculation
          const stakeInfo = await getUserStakeInfo(pool.id, address);
          if (stakeInfo && stakeInfo.stakedAmount) {
            calculatedTotalStakedValue += stakeInfo.stakedAmount;
          }
        }

        const calculatedTotalCollateral = parseFloat(
          await getTotalCollateralAcrossPools(address)
        );

        setProfileData({
          totalDebt: calculatedTotalDebt,
          totalCollateral: calculatedTotalCollateral,
          totalStakedValue: calculatedTotalStakedValue,
        });
      } catch (error) {
        console.error("Error fetching profile data:", error);
        setProfileData(null); // Or set to an error state
      } finally {
        setLoading(false);
      }
    };

    loadProfileData();
  }, [address, signer, fetchBlockchainPools, getUserStakeInfo, getTotalCollateralAcrossPools]);

  // const { userInfo } = useSelector((state: any) => state.next); // Not using Redux user for this

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-amazon_light text-white p-4">
        <h1 className="text-xl font-medium container mx-auto">User Profile</h1>
      </div>

      {/* Page Content */}
      <div className="container mx-auto p-4">
        {/* Wallet Connection Info - Optional, adapt from payment.tsx if needed */}
        {/* <div className="bg-white rounded-lg p-4 mb-6 shadow-sm"> ... </div> */}

        {/* Profile Data Section */}
        <div className="bg-white rounded-lg p-6 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold text-amazon_blue mb-4 border-b pb-2">
            Financial Overview
          </h2>
          {!signer || !address ? (
            <p className="text-gray-600">Please connect your wallet to view your profile data.</p>
          ) : loading ? (
            <p className="text-gray-600">Loading profile data...</p>
          ) : profileData ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-50 p-4 rounded-lg shadow">
                <p className="text-sm text-gray-500 mb-1">Total Debt</p>
                <p className="text-2xl font-bold text-red-500">
                  <FormattedPrice amount={profileData.totalDebt} />
                </p>
              </div>
              <div className="bg-slate-50 p-4 rounded-lg shadow">
                <p className="text-sm text-gray-500 mb-1">Total Collateral</p>
                <p className="text-2xl font-bold text-green-500">
                  <FormattedPrice amount={profileData.totalCollateral} />
                </p>
              </div>
              <div className="bg-slate-50 p-4 rounded-lg shadow">
                <p className="text-sm text-gray-500 mb-1">Total Staked Value</p>
                <p className="text-2xl font-bold text-blue-500">
                  <FormattedPrice amount={profileData.totalStakedValue} />
                </p>
              </div>
            </div>
          ) : (
            <p className="text-red-500">Could not load profile data. Please try again later.</p>
          )}
        </div>

        {/* Action Buttons Section */}
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-amazon_blue mb-4 border-b pb-2">
            Actions
          </h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              // onClick={() => { /* TODO: Implement repay debt functionality */ }}
              className="bg-amazon_yellow text-black py-2 px-4 rounded-lg hover:bg-yellow-500 transition-colors font-medium w-full sm:w-auto"
              disabled // Static for now
            >
              Repay Debt
            </button>
            <button
              // onClick={() => { /* TODO: Implement add money/stake functionality */ }}
              className="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors font-medium w-full sm:w-auto"
              disabled // Static for now
            >
              Add Money / Stake
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
