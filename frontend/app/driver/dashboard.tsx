import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  ScrollView,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { router, useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import Mapbox from '@rnmapbox/maps';
import axios from 'axios';

// Get the API base URL from environment
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://dispatch-fleet.preview.emergentagent.com';
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

// Set Mapbox access token
if (MAPBOX_ACCESS_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface Delivery {
  id: string;
  customer_name: string;
  customer_phone: string;
  pickup_address: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  delivery_address: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  status: string;
  notes?: string;
  created_at: string;
  estimated_arrival?: string;
}

interface UserLocation {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

const DriverDashboard: React.FC = () => {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const locationSubscription = useRef<any>(null);

  // Initialize component with progressive loading
  useEffect(() => {
    // Start with auth check only
    checkAuthAndLoad();
    
    return () => {
      stopLocationTracking();
      if (websocket) {
        websocket.close();
      }
    };
  }, []);

  // Focus effect to refresh data when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (user) {
        loadDeliveries();
      }
    }, [user])
  );

  const checkAuthAndLoad = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const userData = await AsyncStorage.getItem('userData');

      if (!token || !userData) {
        router.replace('/');
        return;
      }

      const parsedUser = JSON.parse(userData);
      if (parsedUser.role !== 'driver') {
        Alert.alert('Access Denied', 'This area is for drivers only');
        router.replace('/');
        return;
      }

      setUser(parsedUser);
      
      // Progressive loading - do these operations after user state is set
      setTimeout(async () => {
        await loadDeliveries();
        // Request location permissions after deliveries are loaded
        setTimeout(() => {
          requestLocationPermissions();
        }, 500);
        // Connect WebSocket last
        setTimeout(() => {
          connectWebSocket(parsedUser.id);
        }, 1000);
      }, 100);
      
    } catch (error) {
      console.error('Auth check error:', error);
      router.replace('/');
    }
  };

  const requestLocationPermissions = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Location permission is required for driver tracking and navigation features.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Get initial location with timeout to prevent hanging
      try {
        const location = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced, // Use balanced instead of high for faster response
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Location timeout')), 10000)
          )
        ]);

        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          heading: location.coords.heading || 0,
          speed: location.coords.speed || 0,
          accuracy: location.coords.accuracy || 0,
        });

        // Start location tracking after getting initial location
        setTimeout(() => {
          startLocationTracking();
        }, 1000);
        
      } catch (locationError) {
        console.error('Initial location error:', locationError);
        // Set default location (San Francisco) if location fails
        setUserLocation({
          latitude: 37.7749,
          longitude: -122.4194,
          heading: 0,
          speed: 0,
          accuracy: 0,
        });
      }
    } catch (error) {
      console.error('Location permission error:', error);
    }
  };

  const startLocationTracking = async () => {
    if (locationSubscription.current) {
      return; // Already tracking
    }

    try {
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced, // Use balanced for better performance
          timeInterval: 10000, // Update every 10 seconds (less frequent)
          distanceInterval: 20, // Update if moved 20 meters (less sensitive)
        },
        (location) => {
          const newLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            heading: location.coords.heading || 0,
            speed: location.coords.speed || 0,
            accuracy: location.coords.accuracy || 0,
          };

          setUserLocation(newLocation);

          // Send location update via WebSocket (throttled)
          if (websocket && websocket.readyState === WebSocket.OPEN) {
            try {
              websocket.send(JSON.stringify({
                ...newLocation,
                timestamp: new Date().toISOString(),
              }));
            } catch (wsError) {
              console.error('WebSocket send error:', wsError);
            }
          }
        }
      );

      setIsLocationTracking(true);
    } catch (error) {
      console.error('Location tracking error:', error);
    }
  };

  const stopLocationTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    setIsLocationTracking(false);
  };

  const connectWebSocket = async (driverId: string) => {
    // Skip WebSocket connection if already connected
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const wsUrl = `${API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/ws/driver/${driverId}`;
      const ws = new WebSocket(wsUrl);

      // Set timeout for connection
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          console.log('WebSocket connection timeout');
        }
      }, 10000); // 10 second timeout

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connected');
        setWebsocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message:', data);
          
          if (data.type === 'location_ack') {
            // Location update acknowledged
          } else if (data.type === 'delivery_assigned') {
            // New delivery assigned
            loadDeliveries();
            Alert.alert('New Delivery', 'A new delivery has been assigned to you');
          }
        } catch (error) {
          console.error('WebSocket message parsing error:', error);
        }
      };

      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket disconnected');
        setWebsocket(null);
        // Attempt to reconnect after 10 seconds (less aggressive)
        setTimeout(() => {
          if (user) {
            connectWebSocket(user.id);
          }
        }, 10000);
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', error);
        setWebsocket(null);
      };

    } catch (error) {
      console.error('WebSocket connection error:', error);
    }
  };

  const loadDeliveries = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const response = await axios.get(`${API_BASE_URL}/api/deliveries`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setDeliveries(response.data.deliveries || []);
    } catch (error) {
      console.error('Load deliveries error:', error);
      Alert.alert('Error', 'Failed to load deliveries');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const updateDeliveryStatus = async (deliveryId: string, status: string) => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      await axios.put(
        `${API_BASE_URL}/api/deliveries/${deliveryId}/status`,
        { status },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await loadDeliveries();
      Alert.alert('Success', `Delivery status updated to ${status}`);
    } catch (error) {
      console.error('Update status error:', error);
      Alert.alert('Error', 'Failed to update delivery status');
    }
  };

  const startNavigation = async (delivery: Delivery) => {
    if (!userLocation) {
      Alert.alert('Location Error', 'Unable to get your current location');
      return;
    }

    if (!delivery.delivery_latitude || !delivery.delivery_longitude) {
      Alert.alert('Location Error', 'Delivery location coordinates not available');
      return;
    }

    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('authToken');

      // Calculate route
      const routeResponse = await axios.post(
        `${API_BASE_URL}/api/route/calculate`,
        {
          origin: {
            longitude: userLocation.longitude,
            latitude: userLocation.latitude,
          },
          destination: {
            longitude: delivery.delivery_longitude,
            latitude: delivery.delivery_latitude,
          },
          profile: 'mapbox/driving-traffic',
          steps: true,
          voice_instructions: true,
          banner_instructions: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (routeResponse.data.success) {
        // Start navigation
        await axios.post(
          `${API_BASE_URL}/api/delivery/${delivery.id}/navigation/start`,
          { route: routeResponse.data },
          { headers: { Authorization: `Bearer ${token}` } }
        );

        setNavigationActive(true);
        setSelectedDelivery(delivery);
        setMapModalVisible(true);
        
        Alert.alert('Navigation Started', 'Turn-by-turn navigation is now active');
      } else {
        Alert.alert('Route Error', 'Failed to calculate route to destination');
      }
    } catch (error) {
      console.error('Navigation error:', error);
      Alert.alert('Navigation Error', 'Failed to start navigation');
    } finally {
      setLoading(false);
    }
  };

  const completeDelivery = async (deliveryId: string) => {
    Alert.alert(
      'Complete Delivery',
      'Mark this delivery as completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem('authToken');
              await axios.post(
                `${API_BASE_URL}/api/delivery/${deliveryId}/complete`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
              );

              setNavigationActive(false);
              setMapModalVisible(false);
              await loadDeliveries();
              Alert.alert('Success', 'Delivery completed successfully!');
            } catch (error) {
              console.error('Complete delivery error:', error);
              Alert.alert('Error', 'Failed to complete delivery');
            }
          },
        },
      ]
    );
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          onPress: async () => {
            await AsyncStorage.multiRemove(['authToken', 'userData']);
            stopLocationTracking();
            if (websocket) {
              websocket.close();
            }
            router.replace('/');
          },
        },
      ]
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadDeliveries();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned':
        return '#f59e0b';
      case 'picked_up':
        return '#3b82f6';
      case 'in_transit':
        return '#10b981';
      case 'delivered':
        return '#8b5cf6';
      default:
        return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'assigned':
        return 'Assigned';
      case 'picked_up':
        return 'Picked Up';
      case 'in_transit':
        return 'In Transit';
      case 'delivered':
        return 'Delivered';
      default:
        return status;
    }
  };

  const renderDeliveryCard = (delivery: Delivery) => (
    <View key={delivery.id} style={styles.deliveryCard}>
      <View style={styles.deliveryHeader}>
        <Text style={styles.customerName}>{delivery.customer_name}</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(delivery.status) }]}>
          <Text style={styles.statusText}>{getStatusText(delivery.status)}</Text>
        </View>
      </View>

      <View style={styles.addressContainer}>
        <Text style={styles.addressLabel}>Pickup:</Text>
        <Text style={styles.addressText}>{delivery.pickup_address}</Text>
      </View>

      <View style={styles.addressContainer}>
        <Text style={styles.addressLabel}>Delivery:</Text>
        <Text style={styles.addressText}>{delivery.delivery_address}</Text>
      </View>

      {delivery.notes && (
        <View style={styles.notesContainer}>
          <Text style={styles.notesLabel}>Notes:</Text>
          <Text style={styles.notesText}>{delivery.notes}</Text>
        </View>
      )}

      <View style={styles.deliveryActions}>
        {delivery.status === 'assigned' && (
          <>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
              onPress={() => updateDeliveryStatus(delivery.id, 'picked_up')}
            >
              <Text style={styles.actionButtonText}>Mark Picked Up</Text>
            </TouchableOpacity>
          </>
        )}

        {delivery.status === 'picked_up' && (
          <>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#10b981' }]}
              onPress={() => startNavigation(delivery)}
            >
              <Text style={styles.actionButtonText}>Start Navigation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#f59e0b' }]}
              onPress={() => updateDeliveryStatus(delivery.id, 'in_transit')}
            >
              <Text style={styles.actionButtonText}>In Transit</Text>
            </TouchableOpacity>
          </>
        )}

        {delivery.status === 'in_transit' && (
          <>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#10b981' }]}
              onPress={() => startNavigation(delivery)}
            >
              <Text style={styles.actionButtonText}>Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#8b5cf6' }]}
              onPress={() => completeDelivery(delivery.id)}
            >
              <Text style={styles.actionButtonText}>Complete</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#6b7280' }]}
          onPress={() => {
            setSelectedDelivery(delivery);
            setMapModalVisible(true);
          }}
        >
          <Text style={styles.actionButtonText}>View Map</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderMapModal = () => (
    <Modal
      visible={mapModalVisible}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      <View style={styles.mapContainer}>
        <View style={styles.mapHeader}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setMapModalVisible(false)}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
          {selectedDelivery && (
            <Text style={styles.mapTitle}>{selectedDelivery.customer_name}</Text>
          )}
          {navigationActive && (
            <TouchableOpacity
              style={styles.completeButton}
              onPress={() => selectedDelivery && completeDelivery(selectedDelivery.id)}
            >
              <Text style={styles.completeButtonText}>Complete</Text>
            </TouchableOpacity>
          )}
        </View>

        {MAPBOX_ACCESS_TOKEN && selectedDelivery ? (
          <Mapbox.MapView
            ref={mapRef}
            style={styles.map}
            styleURL={Mapbox.StyleURL.Street}
            zoomEnabled={true}
            scrollEnabled={true}
            pitchEnabled={true}
            rotateEnabled={true}
          >
            <Mapbox.Camera
              ref={cameraRef}
              zoomLevel={14}
              centerCoordinate={
                userLocation
                  ? [userLocation.longitude, userLocation.latitude]
                  : [-122.4194, 37.7749]
              }
              animationMode="flyTo"
              animationDuration={1000}
            />

            {userLocation && (
              <Mapbox.PointAnnotation
                id="userLocation"
                coordinate={[userLocation.longitude, userLocation.latitude]}
              >
                <View style={styles.userLocationMarker}>
                  <View style={styles.userLocationDot} />
                </View>
              </Mapbox.PointAnnotation>
            )}

            {selectedDelivery.pickup_latitude && selectedDelivery.pickup_longitude && (
              <Mapbox.PointAnnotation
                id="pickupLocation"
                coordinate={[selectedDelivery.pickup_longitude, selectedDelivery.pickup_latitude]}
              >
                <View style={styles.pickupMarker}>
                  <Text style={styles.markerText}>P</Text>
                </View>
              </Mapbox.PointAnnotation>
            )}

            {selectedDelivery.delivery_latitude && selectedDelivery.delivery_longitude && (
              <Mapbox.PointAnnotation
                id="deliveryLocation"
                coordinate={[selectedDelivery.delivery_longitude, selectedDelivery.delivery_latitude]}
              >
                <View style={styles.deliveryMarker}>
                  <Text style={styles.markerText}>D</Text>
                </View>
              </Mapbox.PointAnnotation>
            )}
          </Mapbox.MapView>
        ) : (
          <View style={styles.mapPlaceholder}>
            <Text style={styles.mapPlaceholderText}>
              {!MAPBOX_ACCESS_TOKEN ? 'Map unavailable - Mapbox token missing' : 'Loading map...'}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );

  if (loading && deliveries.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading driver dashboard...</Text>
        <Text style={styles.loadingSubtext}>Setting up location tracking and deliveries</Text>
      </View>
    );
  }

  // Show basic UI immediately when user is loaded, even if deliveries are still loading
  if (!user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Checking authentication...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Driver Dashboard</Text>
          <Text style={styles.headerSubtitle}>
            Welcome, {user?.name} • {isLocationTracking ? '📍 Tracking' : '❌ No GPS'}
          </Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{deliveries.length}</Text>
          <Text style={styles.statLabel}>Total Deliveries</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>
            {deliveries.filter(d => d.status === 'assigned' || d.status === 'picked_up' || d.status === 'in_transit').length}
          </Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>
            {deliveries.filter(d => d.status === 'delivered').length}
          </Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      <ScrollView
        style={styles.deliveriesContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {deliveries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No deliveries assigned yet</Text>
            <Text style={styles.emptySubtext}>Pull down to refresh</Text>
          </View>
        ) : (
          deliveries.map(renderDeliveryCard)
        )}
      </ScrollView>

      {renderMapModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
  },
  loadingSubtext: {
    marginTop: 8,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  logoutButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2563eb',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  deliveriesContainer: {
    flex: 1,
    padding: 16,
  },
  deliveryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  deliveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  customerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  addressContainer: {
    marginBottom: 8,
  },
  addressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 14,
    color: '#374151',
  },
  notesContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    color: '#374151',
  },
  deliveryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    flexShrink: 1,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#6b7280',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
  },
  mapContainer: {
    flex: 1,
  },
  mapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
  },
  closeButton: {
    backgroundColor: '#6b7280',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  mapTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
    textAlign: 'center',
  },
  completeButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  map: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  mapPlaceholderText: {
    fontSize: 16,
    color: '#6b7280',
  },
  userLocationMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userLocationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  pickupMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f59e0b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deliveryMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default DriverDashboard;