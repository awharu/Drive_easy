import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

interface Delivery {
  id: string;
  customer_name: string;
  pickup_address: string;
  delivery_address: string;
  status: 'created' | 'assigned' | 'in_progress' | 'delivered' | 'cancelled';
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

interface Location {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  timestamp: string;
}

interface TrackingInfo {
  delivery: Delivery;
  location?: Location;
}

export default function TrackingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [trackingInfo, setTrackingInfo] = useState<TrackingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (token) {
      loadTrackingInfo();
      setupWebSocket();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]);

  const loadTrackingInfo = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/track/${token}`);
      
      if (response.ok) {
        const data = await response.json();
        setTrackingInfo(data);
        setError(null);
      } else if (response.status === 404) {
        setError('Tracking information not found. Please check your tracking link.');
      } else {
        setError('Failed to load tracking information.');
      }
    } catch (error) {
      setError('Network error. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  const setupWebSocket = () => {
    try {
      const wsUrl = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      const ws = new WebSocket(`${wsUrl}/api/ws/track/${token}`);
      
      ws.onopen = () => {
        console.log('WebSocket connected for tracking');
      };
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === 'location_update' && trackingInfo) {
          setTrackingInfo(prev => {
            if (!prev) return prev;
            
            return {
              ...prev,
              location: {
                lat: message.lat,
                lng: message.lng,
                heading: message.heading,
                speed: message.speed,
                timestamp: message.timestamp,
              }
            };
          });
        } else if (message.type === 'delivery_updated') {
          loadTrackingInfo(); // Refresh delivery info when status changes
        }
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            setupWebSocket();
          }
        }, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to setup WebSocket:', error);
    }
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

  const getStatusMessage = (status: string) => {
    switch (status) {
      case 'created':
        return 'Your delivery has been created and is waiting to be assigned to a driver.';
      case 'assigned':
        return 'A driver has been assigned to your delivery and will start soon.';
      case 'in_progress':
        return 'Your driver is on the way! You can see their live location below.';
      case 'delivered':
        return 'Your delivery has been completed successfully!';
      case 'cancelled':
        return 'Your delivery has been cancelled.';
      default:
        return 'Unknown status';
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading tracking information...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={64} color="#ef4444" />
          <Text style={styles.errorTitle}>Tracking Error</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!trackingInfo) {
    return null;
  }

  const { delivery, location } = trackingInfo;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="location" size={32} color="#2563eb" />
        <Text style={styles.headerTitle}>Track Your Delivery</Text>
      </View>

      {/* Status */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(delivery.status) }]}>
          <Ionicons name={getStatusIcon(delivery.status)} size={24} color="#fff" />
          <Text style={styles.statusText}>{delivery.status.replace('_', ' ')}</Text>
        </View>
        <Text style={styles.statusMessage}>{getStatusMessage(delivery.status)}</Text>
      </View>

      {/* Delivery Info */}
      <View style={styles.deliveryInfo}>
        <Text style={styles.customerName}>Hello, {delivery.customer_name}!</Text>
        
        <View style={styles.addressContainer}>
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={20} color="#6b7280" />
            <View style={styles.addressInfo}>
              <Text style={styles.addressLabel}>Pickup</Text>
              <Text style={styles.addressText}>{delivery.pickup_address}</Text>
            </View>
          </View>
          
          <View style={styles.addressConnector} />
          
          <View style={styles.addressRow}>
            <Ionicons name="flag-outline" size={20} color="#6b7280" />
            <View style={styles.addressInfo}>
              <Text style={styles.addressLabel}>Delivery</Text>
              <Text style={styles.addressText}>{delivery.delivery_address}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Live Location */}
      {delivery.status === 'in_progress' && location && (
        <View style={styles.locationContainer}>
          <View style={styles.locationHeader}>
            <Ionicons name="navigate-circle" size={24} color="#10b981" />
            <Text style={styles.locationTitle}>Driver Location</Text>
            <Text style={styles.liveIndicator}>LIVE</Text>
          </View>
          
          <Text style={styles.locationCoords}>
            Lat: {location.lat.toFixed(6)}, Lng: {location.lng.toFixed(6)}
          </Text>
          
          {location.speed && (
            <Text style={styles.locationSpeed}>
              Speed: {(location.speed * 3.6).toFixed(1)} km/h
            </Text>
          )}
          
          <Text style={styles.locationTime}>
            Last updated: {new Date(location.timestamp).toLocaleTimeString()}
          </Text>
        </View>
      )}

      {/* Timeline */}
      <View style={styles.timeline}>
        <Text style={styles.timelineTitle}>Delivery Timeline</Text>
        
        <View style={styles.timelineItem}>
          <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineText}>Order Created</Text>
            <Text style={styles.timelineTime}>{formatTime(delivery.created_at)}</Text>
          </View>
        </View>
        
        {delivery.started_at && (
          <View style={styles.timelineItem}>
            <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineText}>Delivery Started</Text>
              <Text style={styles.timelineTime}>{formatTime(delivery.started_at)}</Text>
            </View>
          </View>
        )}
        
        {delivery.completed_at && (
          <View style={styles.timelineItem}>
            <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineText}>Delivery Completed</Text>
              <Text style={styles.timelineTime}>{formatTime(delivery.completed_at)}</Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748b',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  errorText: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 24,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  statusContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    marginBottom: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 25,
    gap: 8,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  statusMessage: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 24,
  },
  deliveryInfo: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  customerName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 16,
  },
  addressContainer: {
    position: 'relative',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 8,
  },
  addressInfo: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 16,
    color: '#1e293b',
    lineHeight: 22,
  },
  addressConnector: {
    width: 2,
    height: 20,
    backgroundColor: '#e2e8f0',
    marginLeft: 9,
    marginVertical: 4,
  },
  locationContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  locationTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  liveIndicator: {
    backgroundColor: '#ef4444',
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  locationCoords: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 4,
  },
  locationSpeed: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 4,
  },
  locationTime: {
    fontSize: 12,
    color: '#94a3b8',
  },
  timeline: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  timelineTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  timelineContent: {
    flex: 1,
  },
  timelineText: {
    fontSize: 16,
    color: '#1e293b',
    marginBottom: 2,
  },
  timelineTime: {
    fontSize: 14,
    color: '#64748b',
  },
});