import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

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
  tracking_token: string;
}

interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  
  // Form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const getAuthHeaders = async () => {
    const token = await AsyncStorage.getItem('authToken');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  };

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadDeliveries(), loadDrivers()]);
    } catch (error) {
      Alert.alert('Error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/deliveries`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        setDeliveries(data);
      }
    } catch (error) {
      console.error('Error loading deliveries:', error);
    }
  };

  const loadDrivers = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/drivers`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        setDrivers(data);
      }
    } catch (error) {
      console.error('Error loading drivers:', error);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['authToken', 'user']);
    router.replace('/');
  };

  const createDelivery = async () => {
    if (!customerName || !customerPhone || !pickupAddress || !deliveryAddress) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/deliveries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customer_name: customerName,
          customer_phone: customerPhone,
          pickup_address: pickupAddress,
          delivery_address: deliveryAddress,
          notes,
        }),
      });

      if (response.ok) {
        setShowCreateModal(false);
        resetForm();
        loadDeliveries();
        Alert.alert('Success', 'Delivery created successfully');
      } else {
        Alert.alert('Error', 'Failed to create delivery');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const assignDelivery = async (driverId: string) => {
    if (!selectedDelivery) return;

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${API_BASE_URL}/api/deliveries/${selectedDelivery.id}/assign/${driverId}`,
        {
          method: 'PUT',
          headers,
        }
      );

      if (response.ok) {
        setShowAssignModal(false);
        setSelectedDelivery(null);
        loadDeliveries();
        Alert.alert('Success', 'Delivery assigned successfully');
      } else {
        Alert.alert('Error', 'Failed to assign delivery');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const resetForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setPickupAddress('');
    setDeliveryAddress('');
    setNotes('');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'created':
        return '#f59e0b';
      case 'assigned':
        return '#3b82f6';
      case 'in_progress':
        return '#10b981';
      case 'delivered':
        return '#22c55e';
      case 'cancelled':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'created':
        return 'add-circle-outline';
      case 'assigned':
        return 'person-outline';
      case 'in_progress':
        return 'car-outline';
      case 'delivered':
        return 'checkmark-circle-outline';
      case 'cancelled':
        return 'close-circle-outline';
      default:
        return 'help-circle-outline';
    }
  };

  const renderDeliveryItem = ({ item }: { item: Delivery }) => {
    const driver = drivers.find(d => d.id === item.driver_id);
    
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
          
          {driver && (
            <View style={styles.addressRow}>
              <Ionicons name="person-outline" size={16} color="#6b7280" />
              <Text style={styles.addressText}>Driver: {driver.name}</Text>
            </View>
          )}
          
          <View style={styles.addressRow}>
            <Ionicons name="call-outline" size={16} color="#6b7280" />
            <Text style={styles.addressText}>{item.customer_phone}</Text>
          </View>
        </View>

        <View style={styles.deliveryActions}>
          <Text style={styles.createdAt}>
            Created {new Date(item.created_at).toLocaleDateString()}
          </Text>
          
          {item.status === 'created' && (
            <TouchableOpacity
              style={styles.assignButton}
              onPress={() => {
                setSelectedDelivery(item);
                setShowAssignModal(true);
              }}
            >
              <Text style={styles.assignButtonText}>Assign Driver</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={24} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{deliveries.length}</Text>
          <Text style={styles.statLabel}>Total Deliveries</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>
            {deliveries.filter(d => d.status === 'in_progress').length}
          </Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{drivers.length}</Text>
          <Text style={styles.statLabel}>Drivers</Text>
        </View>
      </View>

      {/* Create Delivery Button */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => setShowCreateModal(true)}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={styles.createButtonText}>Create Delivery</Text>
      </TouchableOpacity>

      {/* Deliveries List */}
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

      {/* Create Delivery Modal */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create New Delivery</Text>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Ionicons name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Customer Name *</Text>
              <TextInput
                style={styles.input}
                value={customerName}
                onChangeText={setCustomerName}
                placeholder="Enter customer name"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Customer Phone *</Text>
              <TextInput
                style={styles.input}
                value={customerPhone}
                onChangeText={setCustomerPhone}
                placeholder="+1234567890"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Pickup Address *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={pickupAddress}
                onChangeText={setPickupAddress}
                placeholder="Enter pickup address"
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Delivery Address *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={deliveryAddress}
                onChangeText={setDeliveryAddress}
                placeholder="Enter delivery address"
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional notes (optional)"
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={createDelivery}>
              <Text style={styles.submitButtonText}>Create Delivery</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Assign Driver Modal */}
      <Modal visible={showAssignModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign Driver</Text>
            <TouchableOpacity onPress={() => setShowAssignModal(false)}>
              <Ionicons name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {drivers.map((driver) => (
              <TouchableOpacity
                key={driver.id}
                style={styles.driverCard}
                onPress={() => assignDelivery(driver.id)}
              >
                <View style={styles.driverInfo}>
                  <Ionicons name="person-circle-outline" size={48} color="#2563eb" />
                  <View style={styles.driverDetails}>
                    <Text style={styles.driverName}>{driver.name}</Text>
                    <Text style={styles.driverEmail}>{driver.email}</Text>
                    <Text style={styles.driverPhone}>{driver.phone}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  logoutButton: {
    padding: 8,
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
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    marginHorizontal: 20,
    marginVertical: 16,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  deliveryActions: {
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
  assignButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  assignButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 40,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 2,
  },
  driverEmail: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 2,
  },
  driverPhone: {
    fontSize: 14,
    color: '#64748b',
  },
});