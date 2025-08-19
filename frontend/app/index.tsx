import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  TextInput, 
  Alert,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'driver';
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'admin' | 'driver'>('driver');

  useEffect(() => {
    checkExistingLogin();
  }, []);

  const checkExistingLogin = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const userStr = await AsyncStorage.getItem('user');
      
      if (token && userStr) {
        const user: User = JSON.parse(userStr);
        navigateToApp(user);
      }
    } catch (error) {
      console.log('No existing login found');
    }
  };

  const navigateToApp = (user: User) => {
    if (user.role === 'admin') {
      router.replace('/admin/dashboard');
    } else {
      router.replace('/driver/dashboard');
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        await AsyncStorage.setItem('authToken', data.token);
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        
        navigateToApp(data.user);
      } else {
        Alert.alert('Login Failed', data.detail || 'Invalid credentials');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !password || !name || !phone) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          name,
          phone,
          role,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        await AsyncStorage.setItem('authToken', data.token);
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        
        navigateToApp(data.user);
      } else {
        Alert.alert('Registration Failed', data.detail || 'Registration failed');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Ionicons name="car-sport" size={60} color="#2563eb" />
            <Text style={styles.title}>Delivery Dispatch</Text>
            <Text style={styles.subtitle}>
              {isLogin ? 'Sign in to your account' : 'Create a new account'}
            </Text>
          </View>

          <View style={styles.form}>
            {!isLogin && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter your full name"
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Phone</Text>
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+1234567890"
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Role</Text>
                  <View style={styles.roleSelector}>
                    <TouchableOpacity
                      style={[
                        styles.roleButton,
                        role === 'driver' && styles.roleButtonActive,
                      ]}
                      onPress={() => setRole('driver')}
                    >
                      <Ionicons 
                        name="car" 
                        size={24} 
                        color={role === 'driver' ? '#fff' : '#6b7280'} 
                      />
                      <Text style={[
                        styles.roleButtonText,
                        role === 'driver' && styles.roleButtonTextActive,
                      ]}>Driver</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.roleButton,
                        role === 'admin' && styles.roleButtonActive,
                      ]}
                      onPress={() => setRole('admin')}
                    >
                      <Ionicons 
                        name="settings" 
                        size={24} 
                        color={role === 'admin' ? '#fff' : '#6b7280'} 
                      />
                      <Text style={[
                        styles.roleButtonText,
                        role === 'admin' && styles.roleButtonTextActive,
                      ]}>Admin</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                secureTextEntry
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={isLogin ? handleLogin : handleRegister}
              disabled={loading}
            >
              <Text style={styles.primaryButtonText}>
                {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Sign Up')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setIsLogin(!isLogin)}
            >
              <Text style={styles.secondaryButtonText}>
                {isLogin 
                  ? "Don't have an account? Sign Up" 
                  : "Already have an account? Sign In"
                }
              </Text>
            </TouchableOpacity>

            {/* Demo accounts info */}
            <View style={styles.demoInfo}>
              <Text style={styles.demoTitle}>Demo Accounts</Text>
              <Text style={styles.demoText}>Admin: admin@demo.com / admin123</Text>
              <Text style={styles.demoText}>Driver: driver@demo.com / driver123</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1e293b',
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
  },
  form: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
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
  roleSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  roleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    gap: 8,
  },
  roleButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  roleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  roleButtonTextActive: {
    color: '#fff',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '500',
  },
  demoInfo: {
    marginTop: 32,
    padding: 16,
    backgroundColor: '#e0e7ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  demoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3730a3',
    marginBottom: 8,
  },
  demoText: {
    fontSize: 14,
    color: '#3730a3',
    marginBottom: 4,
  },
});