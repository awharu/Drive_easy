import React, { useState, useEffect } from 'react';
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
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { router, useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

// Get the API base URL from environment
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://dispatch-fleet.preview.emergentagent.com';

interface Delivery {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  pickup_address: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  delivery_address: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  status: string;
  driver_id?: string;
  driver_name?: string;
  notes?: string;
  created_at: string;
  tracking_id?: string;
}

interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

const AdminDashboard: React.FC = () => {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [trackingModalVisible, setTrackingModalVisible] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  
  // Form states
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    pickup_address: '',
    delivery_address: '',
    notes: '',
  });

  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');

  // Initialize component
  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  // Focus effect to refresh data when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (user) {
        loadDeliveries();
        loadDrivers();
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
      if (parsedUser.role !== 'admin') {
        Alert.alert('Access Denied', 'This area is for administrators only');
        router.replace('/');
        return;
      }

      setUser(parsedUser);
      await Promise.all([loadDeliveries(), loadDrivers()]);
    } catch (error) {
      console.error('Auth check error:', error);
      router.replace('/');
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

  const loadDrivers = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const response = await axios.get(`${API_BASE_URL}/api/drivers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setDrivers(response.data.drivers || []);
    } catch (error) {
      console.error('Load drivers error:', error);
    }
  };

  const createDelivery = async () => {
    if (!formData.customer_name || !formData.customer_email || !formData.pickup_address || !formData.delivery_address) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('authToken');
      
      const response = await axios.post(
        `${API_BASE_URL}/api/deliveries`,
        formData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.delivery_id) {
        Alert.alert('Success', 'Delivery created successfully!');
        setCreateModalVisible(false);
        setFormData({
          customer_name: '',
          customer_phone: '',
          customer_email: '',
          pickup_address: '',
          delivery_address: '',
          notes: '',
        });
        await loadDeliveries();
      }
    } catch (error: any) {
      console.error('Create delivery error:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to create delivery';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const assignDelivery = async () => {
    if (!selectedDelivery || !selectedDriverId) {
      Alert.alert('Error', 'Please select a driver');
      return;
    }

    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('authToken');
      
      await axios.post(
        `${API_BASE_URL}/api/deliveries/${selectedDelivery.id}/assign`,
        { driver_id: selectedDriverId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      Alert.alert('Success', 'Delivery assigned successfully!');
      setAssignModalVisible(false);
      setSelectedDelivery(null);
      setSelectedDriverId('');
      await loadDeliveries();
    } catch (error: any) {
      console.error('Assign delivery error:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to assign delivery';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const createTrackingLink = async (delivery: Delivery) => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('authToken');
      
      const response = await axios.post(
        `${API_BASE_URL}/api/deliveries/${delivery.id}/tracking`,
        { customer_email: delivery.customer_email },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        const fullTrackingUrl = `${API_BASE_URL}${response.data.tracking_url}`;
        setTrackingUrl(fullTrackingUrl);
        setSelectedDelivery(delivery);
        setTrackingModalVisible(true);
      }
    } catch (error: any) {
      console.error('Create tracking link error:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to create tracking link';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const copyTrackingUrl = () => {
    // For web compatibility, we'll show an alert with the URL
    if (Platform.OS === 'web') {
      Alert.alert(
        'Tracking URL',
        trackingUrl,
        [
          { text: 'Close', style: 'cancel' },
          {
            text: 'Open Link',
            onPress: () => {
              window.open(trackingUrl, '_blank');
            },
          },
        ]
      );
    } else {
      // For native platforms, you can use clipboard functionality
      Alert.alert('Tracking URL', trackingUrl);
    }
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
            router.replace('/');
          },
        },
      ]
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([loadDeliveries(), loadDrivers()]);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#6b7280';
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
      case 'pending':
        return 'Pending';
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

      <View style={styles.deliveryInfo}>
        <Text style={styles.infoLabel}>Phone: {delivery.customer_phone}</Text>
        <Text style={styles.infoLabel}>Email: {delivery.customer_email}</Text>
        
        <View style={styles.addressContainer}>
          <Text style={styles.addressLabel}>Pickup:</Text>
          <Text style={styles.addressText}>{delivery.pickup_address}</Text>
        </View>

        <View style={styles.addressContainer}>
          <Text style={styles.addressLabel}>Delivery:</Text>
          <Text style={styles.addressText}>{delivery.delivery_address}</Text>
        </View>

        {delivery.driver_name && (
          <Text style={styles.driverInfo}>Driver: {delivery.driver_name}</Text>
        )}

        {delivery.notes && (
          <View style={styles.notesContainer}>
            <Text style={styles.notesLabel}>Notes:</Text>
            <Text style={styles.notesText}>{delivery.notes}</Text>
          </View>
        )}
      </View>

      <View style={styles.deliveryActions}>
        {delivery.status === 'pending' && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#f59e0b' }]}
            onPress={() => {
              setSelectedDelivery(delivery);
              setAssignModalVisible(true);
            }}
          >
            <Text style={styles.actionButtonText}>Assign Driver</Text>
          </TouchableOpacity>
        )}

        {delivery.status !== 'pending' && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
            onPress={() => createTrackingLink(delivery)}
          >
            <Text style={styles.actionButtonText}>Create Tracking Link</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderCreateModal = () => (
    <Modal
      visible={createModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>New Delivery</Text>
          <TouchableOpacity onPress={createDelivery} disabled={loading}>
            <Text style={[styles.saveButtonText, loading && styles.disabledText]}>Create</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Customer Name *</Text>
            <TextInput
              style={styles.textInput}
              value={formData.customer_name}
              onChangeText={(text) => setFormData({ ...formData, customer_name: text })}
              placeholder="Enter customer name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Customer Phone</Text>
            <TextInput
              style={styles.textInput}
              value={formData.customer_phone}
              onChangeText={(text) => setFormData({ ...formData, customer_phone: text })}
              placeholder="Enter phone number"
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Customer Email *</Text>
            <TextInput
              style={styles.textInput}
              value={formData.customer_email}
              onChangeText={(text) => setFormData({ ...formData, customer_email: text })}
              placeholder="Enter email address"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Pickup Address *</Text>
            <TextInput
              style={styles.textInput}
              value={formData.pickup_address}
              onChangeText={(text) => setFormData({ ...formData, pickup_address: text })}
              placeholder="Enter pickup address"
              multiline
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Delivery Address *</Text>
            <TextInput
              style={styles.textInput}
              value={formData.delivery_address}
              onChangeText={(text) => setFormData({ ...formData, delivery_address: text })}
              placeholder="Enter delivery address"
              multiline
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Notes</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              value={formData.notes}
              onChangeText={(text) => setFormData({ ...formData, notes: text })}
              placeholder="Enter additional notes"
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  const renderAssignModal = () => (
    <Modal
      visible={assignModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setAssignModalVisible(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Assign Driver</Text>
          <TouchableOpacity onPress={assignDelivery} disabled={loading || !selectedDriverId}>
            <Text style={[styles.saveButtonText, (!selectedDriverId || loading) && styles.disabledText]}>
              Assign
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalContent}>
          {selectedDelivery && (
            <View style={styles.deliveryPreview}>
              <Text style={styles.previewTitle}>Delivery for {selectedDelivery.customer_name}</Text>
              <Text style={styles.previewAddress}>{selectedDelivery.delivery_address}</Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Select Driver:</Text>
          
          {drivers.length === 0 ? (
            <Text style={styles.emptyText}>No drivers available</Text>
          ) : (
            drivers.map((driver) => (
              <TouchableOpacity
                key={driver.id}
                style={[
                  styles.driverOption,
                  selectedDriverId === driver.id && styles.selectedDriverOption,
                ]}
                onPress={() => setSelectedDriverId(driver.id)}
              >
                <Text style={styles.driverName}>{driver.name}</Text>
                <Text style={styles.driverDetails}>{driver.email} • {driver.phone}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </View>
    </Modal>
  );

  const renderTrackingModal = () => (
    <Modal
      visible={trackingModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setTrackingModalVisible(false)}>
            <Text style={styles.cancelButtonText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Tracking Link</Text>
          <TouchableOpacity onPress={copyTrackingUrl}>
            <Text style={styles.saveButtonText}>Share</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalContent}>
          {selectedDelivery && (
            <View style={styles.deliveryPreview}>
              <Text style={styles.previewTitle}>Tracking for {selectedDelivery.customer_name}</Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Customer Tracking URL:</Text>
          
          <View style={styles.urlContainer}>
            <Text style={styles.urlText}>{trackingUrl}</Text>
          </View>

          <Text style={styles.urlHelperText}>
            Share this link with the customer to track their delivery in real-time.
          </Text>
        </View>
      </View>
    </Modal>
  );

  if (loading && deliveries.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Admin Dashboard</Text>
          <Text style={styles.headerSubtitle}>Welcome, {user?.name}</Text>
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
            {deliveries.filter(d => d.status === 'pending' || d.status === 'assigned' || d.status === 'picked_up' || d.status === 'in_transit').length}
          </Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>
            {deliveries.filter(d => d.status === 'delivered').length}
          </Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{drivers.length}</Text>
          <Text style={styles.statLabel}>Drivers</Text>
        </View>
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setCreateModalVisible(true)}
        >
          <Text style={styles.createButtonText}>+ New Delivery</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.deliveriesContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {deliveries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No deliveries created yet</Text>
            <Text style={styles.emptySubtext}>Create your first delivery to get started</Text>
          </View>
        ) : (
          deliveries.map(renderDeliveryCard)
        )}
      </ScrollView>

      {renderCreateModal()}
      {renderAssignModal()}
      {renderTrackingModal()}
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
  actionsContainer: {
    padding: 16,
    paddingTop: 0,
  },
  createButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deliveriesContainer: {
    flex: 1,
    paddingHorizontal: 16,
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
  deliveryInfo: {
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  addressContainer: {
    marginTop: 8,
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
  driverInfo: {
    fontSize: 14,
    color: '#2563eb',
    fontWeight: '600',
    marginTop: 8,
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
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
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
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#6b7280',
  },
  saveButtonText: {
    fontSize: 16,
    color: '#2563eb',
    fontWeight: '600',
  },
  disabledText: {
    color: '#9ca3af',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  deliveryPreview: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  previewAddress: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
  },
  driverOption: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedDriverOption: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  driverName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  driverDetails: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  urlContainer: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 12,
  },
  urlText: {
    fontSize: 14,
    color: '#2563eb',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  urlHelperText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default AdminDashboard;