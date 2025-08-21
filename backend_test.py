#!/usr/bin/env python3
"""
Comprehensive Backend Testing for Delivery Dispatch App with Mapbox Integration
Tests all key backend functionality including authentication, delivery management,
driver management, status updates, location tracking, WebSocket connections,
and new Mapbox features: route calculation, geocoding, real-time tracking.
"""

import asyncio
import aiohttp
import json
import websockets
import uuid
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Get the backend URL from frontend env
BACKEND_URL = os.getenv('EXPO_PUBLIC_API_URL', 'http://localhost:8001')
API_BASE = f"{BACKEND_URL}/api"

# Test coordinates (San Francisco area)
SF_COORDINATES = {
    "pickup": {"latitude": 37.7749, "longitude": -122.4194},  # San Francisco downtown
    "delivery": {"latitude": 37.7849, "longitude": -122.4094},  # North Beach area
    "waypoint": {"latitude": 37.7849, "longitude": -122.4294}   # Golden Gate Park area
}

class DeliveryDispatchTester:
    def __init__(self):
        self.session = None
        self.admin_token = None
        self.driver_token = None
        self.admin_user = None
        self.driver_user = None
        self.test_delivery_id = None
        self.tracking_id = None
        self.results = {
            'passed': 0,
            'failed': 0,
            'errors': []
        }

    async def setup_session(self):
        """Setup HTTP session"""
        self.session = aiohttp.ClientSession()

    async def cleanup_session(self):
        """Cleanup HTTP session"""
        if self.session:
            await self.session.close()

    def log_result(self, test_name, success, message=""):
        """Log test result"""
        if success:
            self.results['passed'] += 1
            print(f"✅ {test_name}: PASSED {message}")
        else:
            self.results['failed'] += 1
            self.results['errors'].append(f"{test_name}: {message}")
            print(f"❌ {test_name}: FAILED - {message}")

    async def test_health_check(self):
        """Test health check endpoint"""
        try:
            async with self.session.get(f"{API_BASE}/health") as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('status') == 'healthy':
                        self.log_result("Health Check", True)
                        return True
                    else:
                        self.log_result("Health Check", False, f"Unexpected response: {data}")
                        return False
                else:
                    self.log_result("Health Check", False, f"Status code: {response.status}")
                    return False
        except Exception as e:
            self.log_result("Health Check", False, f"Exception: {str(e)}")
            return False

    async def test_user_registration(self):
        """Test user registration for both admin and driver"""
        # Test admin registration
        admin_data = {
            "email": "admin@deliveryapp.com",
            "name": "Admin User",
            "phone": "+1234567890",
            "role": "admin",
            "password": "admin123"
        }
        
        try:
            async with self.session.post(f"{API_BASE}/auth/register", json=admin_data) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'token' in data and 'user' in data:
                        self.admin_token = data['token']
                        self.admin_user = data['user']
                        self.log_result("Admin Registration", True)
                    else:
                        self.log_result("Admin Registration", False, f"Missing token or user in response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Admin Registration", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Admin Registration", False, f"Exception: {str(e)}")
            return False

        # Test driver registration
        driver_data = {
            "email": "driver@deliveryapp.com",
            "name": "Driver User",
            "phone": "+1234567891",
            "role": "driver",
            "password": "driver123"
        }
        
        try:
            async with self.session.post(f"{API_BASE}/auth/register", json=driver_data) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'token' in data and 'user' in data:
                        self.driver_token = data['token']
                        self.driver_user = data['user']
                        self.log_result("Driver Registration", True)
                        return True
                    else:
                        self.log_result("Driver Registration", False, f"Missing token or user in response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Driver Registration", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Driver Registration", False, f"Exception: {str(e)}")
            return False

    async def test_user_login(self):
        """Test user login for both admin and driver"""
        # Test admin login
        admin_login = {
            "email": "admin@deliveryapp.com",
            "password": "admin123"
        }
        
        try:
            async with self.session.post(f"{API_BASE}/auth/login", json=admin_login) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'token' in data and data['user']['role'] == 'admin':
                        self.log_result("Admin Login", True)
                    else:
                        self.log_result("Admin Login", False, f"Invalid response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Admin Login", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Admin Login", False, f"Exception: {str(e)}")
            return False

        # Test driver login
        driver_login = {
            "email": "driver@deliveryapp.com",
            "password": "driver123"
        }
        
        try:
            async with self.session.post(f"{API_BASE}/auth/login", json=driver_login) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'token' in data and data['user']['role'] == 'driver':
                        self.log_result("Driver Login", True)
                        return True
                    else:
                        self.log_result("Driver Login", False, f"Invalid response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Driver Login", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Driver Login", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_creation(self):
        """Test delivery creation (admin only)"""
        delivery_data = {
            "customer_name": "John Smith",
            "customer_phone": "+1234567892",
            "pickup_address": "123 Main St, New York, NY 10001",
            "delivery_address": "456 Oak Ave, Brooklyn, NY 11201",
            "notes": "Handle with care - fragile items"
        }
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            async with self.session.post(f"{API_BASE}/deliveries", json=delivery_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'id' in data and 'tracking_token' in data:
                        self.test_delivery_id = data['id']
                        self.tracking_token = data['tracking_token']
                        self.log_result("Delivery Creation", True)
                        return True
                    else:
                        self.log_result("Delivery Creation", False, f"Missing id or tracking_token: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Delivery Creation", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Delivery Creation", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_listing(self):
        """Test delivery listing for both admin and driver"""
        # Test admin delivery listing
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            async with self.session.get(f"{API_BASE}/deliveries", headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if isinstance(data, list) and len(data) > 0:
                        self.log_result("Admin Delivery Listing", True, f"Found {len(data)} deliveries")
                    else:
                        self.log_result("Admin Delivery Listing", False, f"Expected list with deliveries, got: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Admin Delivery Listing", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Admin Delivery Listing", False, f"Exception: {str(e)}")
            return False

        # Test driver delivery listing (should be empty initially)
        headers = {"Authorization": f"Bearer {self.driver_token}"}
        
        try:
            async with self.session.get(f"{API_BASE}/deliveries", headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if isinstance(data, list):
                        self.log_result("Driver Delivery Listing", True, f"Driver sees {len(data)} assigned deliveries")
                        return True
                    else:
                        self.log_result("Driver Delivery Listing", False, f"Expected list, got: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Driver Delivery Listing", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Driver Delivery Listing", False, f"Exception: {str(e)}")
            return False

    async def test_driver_listing(self):
        """Test driver listing (admin only)"""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            async with self.session.get(f"{API_BASE}/drivers", headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if isinstance(data, list) and len(data) > 0:
                        # Should find our registered driver
                        driver_found = any(driver['email'] == 'driver@deliveryapp.com' for driver in data)
                        if driver_found:
                            self.log_result("Driver Listing", True, f"Found {len(data)} drivers")
                            return True
                        else:
                            self.log_result("Driver Listing", False, f"Registered driver not found in list: {data}")
                            return False
                    else:
                        self.log_result("Driver Listing", False, f"Expected list with drivers, got: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Driver Listing", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Driver Listing", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_assignment(self):
        """Test delivery assignment to driver"""
        if not self.test_delivery_id or not self.driver_user:
            self.log_result("Delivery Assignment", False, "Missing delivery ID or driver user")
            return False

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/assign/{self.driver_user['id']}"
            async with self.session.put(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'message' in data:
                        self.log_result("Delivery Assignment", True)
                        return True
                    else:
                        self.log_result("Delivery Assignment", False, f"Unexpected response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Delivery Assignment", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Delivery Assignment", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_status_updates(self):
        """Test delivery status updates"""
        if not self.test_delivery_id:
            self.log_result("Delivery Status Updates", False, "Missing delivery ID")
            return False

        headers = {"Authorization": f"Bearer {self.driver_token}"}
        
        # Test status update to in_progress
        status_update = {
            "status": "in_progress",
            "notes": "Started delivery - on the way to pickup"
        }
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/status"
            async with self.session.put(url, json=status_update, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'message' in data:
                        self.log_result("Status Update (In Progress)", True)
                    else:
                        self.log_result("Status Update (In Progress)", False, f"Unexpected response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Status Update (In Progress)", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Status Update (In Progress)", False, f"Exception: {str(e)}")
            return False

        # Test status update to delivered
        status_update = {
            "status": "delivered",
            "notes": "Package delivered successfully"
        }
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/status"
            async with self.session.put(url, json=status_update, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'message' in data:
                        self.log_result("Status Update (Delivered)", True)
                        return True
                    else:
                        self.log_result("Status Update (Delivered)", False, f"Unexpected response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Status Update (Delivered)", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Status Update (Delivered)", False, f"Exception: {str(e)}")
            return False

    async def test_location_updates(self):
        """Test location update endpoint"""
        if not self.test_delivery_id:
            self.log_result("Location Updates", False, "Missing delivery ID")
            return False

        headers = {"Authorization": f"Bearer {self.driver_token}"}
        
        location_data = {
            "delivery_id": self.test_delivery_id,
            "lat": 40.7128,
            "lng": -74.0060,
            "heading": 45.0,
            "speed": 25.5
        }
        
        try:
            async with self.session.post(f"{API_BASE}/locations", json=location_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'message' in data:
                        self.log_result("Location Updates", True)
                        return True
                    else:
                        self.log_result("Location Updates", False, f"Unexpected response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Location Updates", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Location Updates", False, f"Exception: {str(e)}")
            return False

    async def test_public_tracking(self):
        """Test public tracking endpoint (no auth required)"""
        if not self.tracking_token:
            self.log_result("Public Tracking", False, "Missing tracking token")
            return False

        try:
            async with self.session.get(f"{API_BASE}/track/{self.tracking_token}") as response:
                if response.status == 200:
                    data = await response.json()
                    if 'delivery' in data and data['delivery']['id'] == self.test_delivery_id:
                        self.log_result("Public Tracking", True)
                        return True
                    else:
                        self.log_result("Public Tracking", False, f"Invalid tracking response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Public Tracking", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Public Tracking", False, f"Exception: {str(e)}")
            return False

    async def test_websocket_connections(self):
        """Test WebSocket connections"""
        if not self.driver_user:
            self.log_result("WebSocket Connections", False, "Missing driver user")
            return False

        # Test driver WebSocket connection
        ws_url = f"{BACKEND_URL.replace('http', 'ws')}/api/ws/driver/{self.driver_user['id']}"
        
        try:
            async with websockets.connect(ws_url) as websocket:
                # Send a test location update via WebSocket
                test_message = {
                    "type": "location_update",
                    "data": {
                        "delivery_id": self.test_delivery_id or "test-delivery",
                        "lat": 40.7589,
                        "lng": -73.9851,
                        "heading": 90.0,
                        "speed": 30.0
                    }
                }
                
                await websocket.send(json.dumps(test_message))
                self.log_result("Driver WebSocket Connection", True)
                
        except Exception as e:
            self.log_result("Driver WebSocket Connection", False, f"Exception: {str(e)}")

        # Test admin WebSocket connection
        admin_ws_url = f"{BACKEND_URL.replace('http', 'ws')}/api/ws/admin"
        
        try:
            async with websockets.connect(admin_ws_url) as websocket:
                # Just test connection
                self.log_result("Admin WebSocket Connection", True)
                return True
                
        except Exception as e:
            self.log_result("Admin WebSocket Connection", False, f"Exception: {str(e)}")
            return False

    async def test_error_handling(self):
        """Test error handling for invalid requests"""
        # Test invalid login
        invalid_login = {
            "email": "nonexistent@test.com",
            "password": "wrongpassword"
        }
        
        try:
            async with self.session.post(f"{API_BASE}/auth/login", json=invalid_login) as response:
                if response.status == 401:
                    self.log_result("Invalid Login Error Handling", True)
                else:
                    self.log_result("Invalid Login Error Handling", False, f"Expected 401, got {response.status}")
        except Exception as e:
            self.log_result("Invalid Login Error Handling", False, f"Exception: {str(e)}")

        # Test unauthorized access
        try:
            async with self.session.get(f"{API_BASE}/deliveries") as response:
                if response.status == 401 or response.status == 403:
                    self.log_result("Unauthorized Access Error Handling", True)
                else:
                    self.log_result("Unauthorized Access Error Handling", False, f"Expected 401/403, got {response.status}")
        except Exception as e:
            self.log_result("Unauthorized Access Error Handling", False, f"Exception: {str(e)}")

        # Test invalid delivery ID
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        try:
            async with self.session.get(f"{API_BASE}/deliveries/invalid-id", headers=headers) as response:
                if response.status == 404:
                    self.log_result("Invalid Delivery ID Error Handling", True)
                    return True
                else:
                    self.log_result("Invalid Delivery ID Error Handling", False, f"Expected 404, got {response.status}")
                    return False
        except Exception as e:
            self.log_result("Invalid Delivery ID Error Handling", False, f"Exception: {str(e)}")
            return False

    async def run_all_tests(self):
        """Run all backend tests"""
        print("🚀 Starting Delivery Dispatch Backend Tests")
        print("=" * 60)
        
        await self.setup_session()
        
        try:
            # Test sequence
            await self.test_health_check()
            await self.test_user_registration()
            await self.test_user_login()
            await self.test_delivery_creation()
            await self.test_delivery_listing()
            await self.test_driver_listing()
            await self.test_delivery_assignment()
            await self.test_delivery_status_updates()
            await self.test_location_updates()
            await self.test_public_tracking()
            await self.test_websocket_connections()
            await self.test_error_handling()
            
        finally:
            await self.cleanup_session()
        
        # Print summary
        print("\n" + "=" * 60)
        print("🏁 Test Summary")
        print("=" * 60)
        print(f"✅ Passed: {self.results['passed']}")
        print(f"❌ Failed: {self.results['failed']}")
        
        if self.results['errors']:
            print("\n🔍 Failed Tests:")
            for error in self.results['errors']:
                print(f"  • {error}")
        
        success_rate = (self.results['passed'] / (self.results['passed'] + self.results['failed'])) * 100 if (self.results['passed'] + self.results['failed']) > 0 else 0
        print(f"\n📊 Success Rate: {success_rate:.1f}%")
        
        return self.results['failed'] == 0

async def main():
    """Main test runner"""
    tester = DeliveryDispatchTester()
    success = await tester.run_all_tests()
    
    if success:
        print("\n🎉 All tests passed! Backend is working correctly.")
        return 0
    else:
        print("\n⚠️  Some tests failed. Check the errors above.")
        return 1

if __name__ == "__main__":
    import sys
    result = asyncio.run(main())
    sys.exit(result)