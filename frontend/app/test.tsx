import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function TestPage() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Test Page</Text>
      <Text style={styles.subtitle}>If you can see this, React Native is working!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});