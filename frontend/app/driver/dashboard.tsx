import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
  SafeAreaView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

interface Delivery {
  id: string;
  customer_name: string;
  customer_phone: string;
  pickup_address: string;
  delivery_address: string;
  status: 'created' | 'assigned' | 'in_progress' | 'delivered' | 'cancelled';
  driver_id?: string;
  created_at: string;
  assigned_at?: string;
  started_at?: string;
  notes?: string;
}

export default function DriverDashboard() {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);

  useEffect(() => {
    loadDeliveries();
    requestLocationPermission();
  }, []);

  const getAuthHeaders = async () => {
    const token = await AsyncStorage.getItem('authToken');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status === 'granted');
      
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setCurrentLocation(location);
      }
    } catch (error) {
      console.error('Error requesting location permission:', error);
    }
  };

  const loadDeliveries = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/deliveries`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        setDeliveries(data);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['authToken', 'user']);
    router.replace('/');
  };

  const updateDeliveryStatus = async (deliveryId: string, status: string) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/deliveries/${deliveryId}/status`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status }),
      });

      if (response.ok) {
        loadDeliveries();
        Alert.alert('Success', `Delivery ${status.replace('_', ' ')} successfully`);
      } else {
        Alert.alert('Error', 'Failed to update delivery status');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const startNavigation = (delivery: Delivery) => {
    const address = delivery.pickup_address;
    const url = `https://maps.google.com/maps?daddr=${encodeURIComponent(address)}`;
    
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open navigation app');
    });
  };

  const callCustomer = (phoneNumber: string) => {
    const url = `tel:${phoneNumber}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to make phone call');
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned':
        return '#3b82f6';
      case 'in_progress':
        return '#10b981';
      case 'delivered':
        return '#22c55e';
      default:
        return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'assigned':
        return 'person-outline';
      case 'in_progress':
        return 'car-outline';
      case 'delivered':
        return 'checkmark-circle-outline';
      default:
        return 'help-circle-outline';
    }
  };

  const renderDeliveryActions = (item: Delivery) => {
    switch (item.status) {
      case 'assigned':
        return (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.startButton]}
              onPress={() => updateDeliveryStatus(item.id, 'in_progress')}
            >
              <Ionicons name="play" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>Start Delivery</Text>
            </TouchableOpacity>
          </View>
        );
      case 'in_progress':
        return (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.navigateButton]}
              onPress={() => startNavigation(item)}
            >
              <Ionicons name="navigate" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.completeButton]}
              onPress={() => updateDeliveryStatus(item.id, 'delivered')}
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>Complete</Text>
            </TouchableOpacity>
          </View>
        );
      case 'delivered':
        return (
          <View style={styles.deliveredBadge}>
            <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            <Text style={styles.deliveredText}>Delivered</Text>
          </View>
        );
      default:
        return null;
    }
  };

  const renderDeliveryItem = ({ item }: { item: Delivery }) => {
    return (
      <View style={styles.deliveryCard}>
        <View style={styles.deliveryHeader}>
          <Text style={styles.customerName}>{item.customer_name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
            <Ionicons name={getStatusIcon(item.status)} size={16} color="#fff" />
            <Text style={styles.statusText}>{item.status.replace('_', ' ')}</Text>
          </View>
        </View>
        
        <View style={styles.deliveryDetails}>
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={16} color="#6b7280" />
            <Text style={styles.addressText}>From: {item.pickup_address}</Text>
          </View>
          <View style={styles.addressRow}>
            <Ionicons name="flag-outline" size={16} color="#6b7280" />
            <Text style={styles.addressText}>To: {item.delivery_address}</Text>
          </View>
          
          <TouchableOpacity 
            style={styles.addressRow}
            onPress={() => callCustomer(item.customer_phone)}
          >
            <Ionicons name="call-outline" size={16} color="#2563eb" />
            <Text style={[styles.addressText, styles.phoneLink]}>{item.customer_phone}</Text>
          </TouchableOpacity>
          
          {item.notes && (
            <View style={styles.addressRow}>
              <Ionicons name="document-text-outline" size={16} color="#6b7280" />
              <Text style={styles.addressText}>Notes: {item.notes}</Text>
            </View>
          )}
        </View>

        <View style={styles.deliveryFooter}>
          <Text style={styles.createdAt}>
            Created {new Date(item.created_at).toLocaleDateString()}
          </Text>
          {renderDeliveryActions(item)}
        </View>
      </View>
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDeliveries();
    setRefreshing(false);
  };

  const activeDeliveries = deliveries.filter(d => d.status !== 'delivered' && d.status !== 'cancelled');
  const completedDeliveries = deliveries.filter(d => d.status === 'delivered');

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Driver Dashboard</Text>
          <Text style={styles.headerSubtitle}>
            {activeDeliveries.length} active deliveries
          </Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={24} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {/* Location Status */}
      <View style={styles.locationStatus}>
        <Ionicons 
          name={locationPermission ? "location" : "location-outline"} 
          size={20} 
          color={locationPermission ? "#10b981" : "#ef4444"} 
        />
        <Text style={[
          styles.locationText,
          { color: locationPermission ? "#10b981" : "#ef4444" }
        ]}>
          {locationPermission ? "Location enabled" : "Location permission required"}
        </Text>
        {!locationPermission && (
          <TouchableOpacity
            style={styles.enableLocationButton}
            onPress={requestLocationPermission}
          >
            <Text style={styles.enableLocationText}>Enable</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{activeDeliveries.length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{completedDeliveries.length}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>
            {deliveries.filter(d => d.status === 'in_progress').length}
          </Text>
          <Text style={styles.statLabel}>In Progress</Text>
        </View>
      </View>

      {/* Deliveries List */}
      {deliveries.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="car-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyStateTitle}>No Deliveries</Text>
          <Text style={styles.emptyStateText}>
            You don't have any assigned deliveries yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={deliveries}
          keyExtractor={(item) => item.id}
          renderItem={renderDeliveryItem}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  logoutButton: {
    padding: 8,
  },
  locationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  enableLocationButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  enableLocationText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2563eb',
  },
  statLabel: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  deliveryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  deliveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  customerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  deliveryDetails: {
    marginBottom: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  },
  phoneLink: {
    color: '#2563eb',
    textDecorationLine: 'underline',
  },
  deliveryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
  },
  createdAt: {
    fontSize: 12,
    color: '#94a3b8',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: '#10b981',
  },
  navigateButton: {
    backgroundColor: '#3b82f6',
  },
  completeButton: {
    backgroundColor: '#22c55e',
  },
  deliveredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deliveredText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 24,
  },
});