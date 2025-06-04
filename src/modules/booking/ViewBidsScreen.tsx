import React, {useEffect, useState} from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from "react-native";
import {useNavigation, RouteProp} from "@react-navigation/native";
import {NativeStackNavigationProp} from "@react-navigation/native-stack";
import {useRecoilValue} from "recoil"; // If needed for some global state not in socket
import {SocketRideState, useSocket} from "../../hooks/useSocket";
import {usePayment} from "../../hooks/usePayment";
import {rideAtom} from "../../store/atoms/ride/rideAtom"; // For local Recoil state if used beyond socket
import {userAtom} from "../../store/atoms/user/userAtom";
import {Bid} from "../../types/ride/types/ride.types"; // Import Bid type
import {BookingStackParamList} from "../../types/navigation/navigation.types";
import CustomButton from "../../components/CustomButton";
import Margin from "../../components/Margin";
import PaymentModal from "../../components/modals/PaymentModal";
import {
  primaryColor,
  backgroundPrimary,
  successColor,
  errorColor,
} from "../../theme/colors";
import firestore, { addDoc, collection, getFirestore } from "@react-native-firebase/firestore"

// Define local color constants
const localTextPrimaryColor = "#EAEAEA";
const localTextSecondaryColor = "#B0B0B0";
const localAccentColor = primaryColor;

type ViewBidsScreenRouteProp = RouteProp<
  BookingStackParamList,
  "ViewBidsScreen"
>;

// Use NativeStackNavigationProp for stack-specific methods
type ViewBidsNavigationProp = NativeStackNavigationProp<
  BookingStackParamList,
  "ViewBidsScreen"
>;

interface ViewBidsScreenProps {
  route: ViewBidsScreenRouteProp;
}

const ViewBidsScreen: React.FC<ViewBidsScreenProps> = ({ route }) => {
  const navigation = useNavigation<ViewBidsNavigationProp>();
  const { quotationId } = route.params;

  const { currentRideState, selectDriver, isConnected } = useSocket();
  const { createPaymentSession, currentSession, paymentState } = usePayment();
  const user = useRecoilValue(userAtom);

  const [bids, setBids] = useState<Bid[]>([]);
  const [selectedBid, setSelectedBid] = useState<Bid | null>(null);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const db = getFirestore()

  const saveRideDataToFirestore = async (rideData: SocketRideState) => {
    try {
      const docRef = await addDoc(collection(db, 'rideDetails'), {
        userId: user?.uid,
        rideId: rideData.rideId,
        dropoffLocation: rideData.requestDetails?.dropoffLocation,
        pickupLocation: rideData.requestDetails?.pickupLocation,
        selectedDriverInfo: rideData.selectedDriverInfo,
        status: rideData.status,
        amount: rideData.acceptedBidDetails?.amount,
        currency: rideData.acceptedBidDetails?.currency,
        timestamp: rideData.acceptedBidDetails?.timestamp
      });
      console.log("Ride data saved with ID: ", docRef.id);
    } catch (error) {
      console.error("Error saving ride data: ", error);
    }
  };

  useEffect(() => {
    if (
      currentRideState &&
      currentRideState.rideId === quotationId &&
      currentRideState.bids
    ) {
      const newBids = Array.from(currentRideState.bids.values()).map(
        socketBid => {
          // Adapt the structure from socketClient.currentRideProgress.bids to our Bid interface
          // The Bid type in broadcastSocket might be slightly different from the one in rideTypes.ts
          // This is a placeholder mapping - adjust according to actual structures.
          return {
            id: socketBid.driverSocketId, // Assuming driverSocketId can serve as a unique key for the bid display
            quotationRequestId: quotationId,
            driverId: socketBid.driverInfo?.id || socketBid.driverSocketId,
            driverName: socketBid.driverInfo?.name || "N/A",
            driverRating: socketBid.driverInfo?.rating || 0,
            vehicleDetails: socketBid.driverInfo?.vehicle || "N/A",
            bidAmount: socketBid.bidDetails?.amount || 0,
            currency: socketBid.bidDetails?.currency || "USD",
            estimatedArrivalTime: socketBid.bidDetails?.eta || "N/A",
            bidAt: socketBid.bidDetails?.timestamp || new Date().toISOString(),
            status: "PENDING_RIDER_APPROVAL",
            driverFcmToken: socketBid.driverInfo?.fcmToken,
          } as Bid;
        },
      );
      setBids(newBids);
    } else {
      setBids([]); // Clear bids if conditions not met
    }
  }, [currentRideState, quotationId]);

  useEffect(() => {
    if (currentRideState?.rideId === quotationId) {
      if (
        currentRideState.status === "confirmed_in_progress" &&
        currentRideState.selectedDriverInfo &&
        currentRideState.acceptedBidDetails &&
        currentSession?.status === "completed"
      ) {
        console.log("[ViewBidsScreen] Ride confirmed with payment completed");
        // Save ride data to Firestore
        saveRideDataToFirestore(currentRideState);

        Alert.alert(
          "Payment & Ride Confirmed!",
          `Payment successful! You will be riding with ${currentRideState.selectedDriverInfo.name}.`,
          [
            {
              text: "Track Ride",
              onPress: () => {
                if (
                  currentRideState.acceptedBidDetails &&
                  currentRideState.selectedDriverInfo
                ) {
                  navigation.replace("TrackRideScreen", {
                    rideId: quotationId,
                    active_ride_room_id:
                      currentRideState.active_ride_room_id || "",
                    selectedDriverInfo: currentRideState.selectedDriverInfo,
                    rideDetails: currentRideState.requestDetails,
                    acceptedAmount:
                      currentRideState.acceptedBidDetails.amount || 0,
                    acceptedCurrency:
                      currentRideState.acceptedBidDetails.currency || "USD",
                  });
                }
              },
            },
          ],
        );
      } else if (currentRideState.status === "error") {
        Alert.alert(
          "Error",
          currentRideState.errorMessage ||
            "An error occurred with your request.",
        );
        if (navigation.canGoBack()) navigation.goBack();
      } else if (currentRideState.status === "cancelled") {
        Alert.alert("Cancelled", "The ride request has been cancelled.");
        if (navigation.canGoBack()) navigation.goBack();
      }
    }
  }, [currentRideState, quotationId, navigation, currentSession]);

  const handlePaymentComplete = () => {
    console.log(
      "[ViewBidsScreen] Payment completed, proceeding with driver selection",
    );
    setPaymentModalVisible(false);
    setIsProcessingPayment(false);

    if (selectedBid && isConnected) {
      console.log(
        `Selecting driver after payment: ${selectedBid.driverId}, socketId: ${selectedBid.id}`,
      );
      selectDriver(selectedBid.id);
    }
  };

  const handleAcceptBid = async (bid: Bid) => {
    if (!isConnected) {
      Alert.alert("Error", "Not connected to server.");
      return;
    }

    if (
      !currentRideState ||
      currentRideState.rideId !== quotationId ||
      currentRideState.status !== "pending_bids"
    ) {
      Alert.alert(
        "Error",
        "Cannot accept bid: Ride request not found, not active for bidding, or mismatch.",
      );
      return;
    }

    Alert.alert(
      "Confirm Bid & Payment",
      `Accept bid from ${bid.driverName} for ₹${bid.bidAmount}?\n\nYou will need to complete payment before the ride is confirmed.`,
      [
        {text: "Cancel", style: "cancel"},
        {
          text: "Accept & Pay",
          onPress: async () => {
            try {
              setSelectedBid(bid);
              setIsProcessingPayment(true);

              // Create payment session
              const paymentRequest = {
                userId: user?.uid || "guest-user",
                amount: bid.bidAmount,
                rideId: quotationId,
                bidId: bid.id,
              };

              console.log(
                "[ViewBidsScreen] Creating payment session for bid:",
                paymentRequest,
              );

              const session = await createPaymentSession(
                paymentRequest,
                handlePaymentComplete,
              );

              if (session) {
                setPaymentModalVisible(true);
                console.log(
                  "[ViewBidsScreen] Payment session created, showing modal",
                );
              } else {
                setIsProcessingPayment(false);
                setSelectedBid(null);
              }
            } catch (error) {
              console.error(
                "[ViewBidsScreen] Error creating payment session:",
                error,
              );
              setIsProcessingPayment(false);
              setSelectedBid(null);
              Alert.alert(
                "Payment Error",
                "Failed to initiate payment. Please try again.",
              );
            }
          },
        },
      ],
    );
  };

  const handlePaymentModalClose = () => {
    if (!currentSession || currentSession.status === "completed") {
      setPaymentModalVisible(false);
      setIsProcessingPayment(false);
      setSelectedBid(null);
    } else {
      // Payment session is still active, confirm cancellation
      Alert.alert(
        "Cancel Payment",
        "Are you sure you want to cancel the payment? The bid will not be accepted.",
        [
          {text: "Continue Payment", style: "cancel"},
          {
            text: "Cancel",
            style: "destructive",
            onPress: () => {
              setPaymentModalVisible(false);
              setIsProcessingPayment(false);
              setSelectedBid(null);
            },
          },
        ],
      );
    }
  };

  const renderBidItem = ({item}: {item: Bid}) => (
    <TouchableOpacity
      style={styles.bidItem}
      onPress={() => handleAcceptBid(item)}
      disabled={isProcessingPayment}>
      <Text style={styles.driverName}>
        {item.driverName} (Rating:{" "}
        {item.driverRating ? item.driverRating.toFixed(1) : "N/A"}★)
      </Text>
      <Text style={styles.vehicleDetails}>Vehicle: {item.vehicleDetails}</Text>
      <Text style={styles.bidAmount}>
        Bid: ₹{item.bidAmount} (ETA: {item.estimatedArrivalTime})
      </Text>
      <Text style={styles.timestampText}>
        Bid Placed: {new Date(item.bidAt).toLocaleTimeString()}
      </Text>
      {selectedBid?.id === item.id && isProcessingPayment && (
        <View style={styles.processingIndicator}>
          <Text style={styles.processingText}>Processing payment...</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  // Loading states based on socket state
  if (
    !currentRideState ||
    currentRideState.rideId !== quotationId ||
    currentRideState.status === "idle" ||
    currentRideState.status === "creating_quotation_request" ||
    currentRideState.status === "creating_request"
  ) {
    return (
      <View style={styles.containerCentered}>
        <Text style={styles.infoText}>
          Requesting Bids for Quotation ID: {quotationId}...
        </Text>
        <Text style={styles.infoText}>
          Current Status: {currentRideState?.status || "Initializing..."}
        </Text>
      </View>
    );
  }

  // If status is something other than pending_bids (and not a loading/transition state handled above or by navigation effect)
  if (currentRideState.status !== "pending_bids") {
    return (
      <View style={styles.containerCentered}>
        <Text style={styles.infoText}>
          Status: {currentRideState.status}. Waiting for updates or navigation.
        </Text>
        {currentRideState.errorMessage && (
          <Text style={styles.infoTextError}>
            Error: {currentRideState.errorMessage}
          </Text>
        )}
        <Margin margin={10} />
        <CustomButton
          title="Go Back"
          onPress={() => navigation.canGoBack() && navigation.goBack()}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>
        Available Bids for Quotation ID: {quotationId}
      </Text>
      <Text style={styles.subHeader}>
        Select a bid to proceed with payment and ride confirmation
      </Text>

      {bids.length === 0 ? (
        <Text style={styles.infoText}>
          No bids received yet. Waiting for drivers...
        </Text>
      ) : (
        <FlatList
          data={bids}
          renderItem={renderBidItem}
          keyExtractor={item => item.id}
          style={styles.list}
          extraData={isProcessingPayment}
        />
      )}

      <Margin margin={10} />
      <CustomButton
        title="Cancel Quotation"
        onPress={() => {
          Alert.alert(
            "Cancel Quotation",
            "Are you sure you want to cancel this quotation request?",
            [
              {text: "No", style: "cancel"},
              {
                text: "Yes, Cancel",
                style: "destructive",
                onPress: () => navigation.goBack(),
              },
            ],
          );
        }}
        status="danger"
        disabled={isProcessingPayment}
      />

      {/* Payment Modal */}
      <PaymentModal
        visible={paymentModalVisible}
        onClose={handlePaymentModalClose}
        onPaymentComplete={handlePaymentComplete}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: backgroundPrimary,
    padding: 16,
  },
  containerCentered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: backgroundPrimary,
    padding: 16,
  },
  header: {
    fontSize: 20,
    fontWeight: "bold",
    color: localTextPrimaryColor,
    marginBottom: 8,
    textAlign: "center",
  },
  subHeader: {
    fontSize: 14,
    color: localTextSecondaryColor,
    marginBottom: 16,
    textAlign: "center",
  },
  list: {
    flex: 1,
  },
  bidItem: {
    backgroundColor: "#2C3E50",
    padding: 16,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: primaryColor,
  },
  driverName: {
    fontSize: 16,
    fontWeight: "bold",
    color: localTextPrimaryColor,
  },
  vehicleDetails: {
    fontSize: 14,
    color: localTextSecondaryColor,
    marginVertical: 4,
  },
  bidAmount: {
    fontSize: 15,
    fontWeight: "bold",
    color: localAccentColor,
  },
  timestampText: {
    fontSize: 12,
    color: localTextSecondaryColor,
    marginTop: 4,
  },
  processingIndicator: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "rgba(1, 205, 93, 0.1)",
    borderRadius: 4,
  },
  processingText: {
    fontSize: 12,
    color: primaryColor,
    textAlign: "center",
    fontStyle: "italic",
  },
  infoText: {
    fontSize: 16,
    color: localTextSecondaryColor,
    textAlign: "center",
    marginTop: 20,
  },
  infoTextError: {
    color: errorColor,
    fontSize: 16,
    textAlign: "center",
  },
});

export default ViewBidsScreen;
