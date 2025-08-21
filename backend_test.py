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
        """Test delivery creation with automatic geocoding (admin only)"""
        delivery_data = {
            "customer_name": "Sarah Johnson",
            "customer_phone": "+1415555123",
            "customer_email": "sarah.johnson@example.com",
            "pickup_address": "Union Square, San Francisco, CA",
            "delivery_address": "Fisherman's Wharf, San Francisco, CA",
            "notes": "Handle with care - fragile electronics"
        }
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            async with self.session.post(f"{API_BASE}/deliveries", json=delivery_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'delivery_id' in data and 'pickup_coordinates' in data and 'delivery_coordinates' in data:
                        self.test_delivery_id = data['delivery_id']
                        self.log_result("Delivery Creation with Geocoding", True, f"Created delivery with coordinates")
                        return True
                    else:
                        self.log_result("Delivery Creation with Geocoding", False, f"Missing required fields: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Delivery Creation with Geocoding", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Delivery Creation with Geocoding", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_listing(self):
        """Test delivery listing for both admin and driver"""
        # Test admin delivery listing
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            async with self.session.get(f"{API_BASE}/deliveries", headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'deliveries' in data and isinstance(data['deliveries'], list) and len(data['deliveries']) > 0:
                        self.log_result("Admin Delivery Listing", True, f"Found {len(data['deliveries'])} deliveries")
                    else:
                        self.log_result("Admin Delivery Listing", False, f"Expected deliveries list, got: {data}")
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
                    if 'deliveries' in data and isinstance(data['deliveries'], list):
                        self.log_result("Driver Delivery Listing", True, f"Driver sees {len(data['deliveries'])} assigned deliveries")
                        return True
                    else:
                        self.log_result("Driver Delivery Listing", False, f"Expected deliveries list, got: {data}")
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
                    if 'drivers' in data and isinstance(data['drivers'], list) and len(data['drivers']) > 0:
                        # Should find our registered driver
                        driver_found = any(driver['email'] == 'driver@deliveryapp.com' for driver in data['drivers'])
                        if driver_found:
                            self.log_result("Driver Listing", True, f"Found {len(data['drivers'])} drivers")
                            return True
                        else:
                            self.log_result("Driver Listing", False, f"Registered driver not found in list: {data}")
                            return False
                    else:
                        self.log_result("Driver Listing", False, f"Expected drivers list, got: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Driver Listing", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Driver Listing", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_assignment(self):
        """Test delivery assignment to driver with location support"""
        if not self.test_delivery_id or not self.driver_user:
            self.log_result("Delivery Assignment", False, "Missing delivery ID or driver user")
            return False

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        assignment_data = {"driver_id": self.driver_user['id']}
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/assign"
            async with self.session.post(url, json=assignment_data, headers=headers) as response:
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
        
        # Test status update to picked_up
        status_update = {"status": "picked_up"}
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/status"
            async with self.session.put(url, json=status_update, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'message' in data:
                        self.log_result("Status Update (Picked Up)", True)
                    else:
                        self.log_result("Status Update (Picked Up)", False, f"Unexpected response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Status Update (Picked Up)", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Status Update (Picked Up)", False, f"Exception: {str(e)}")
            return False

        # Test status update to in_transit
        status_update = {"status": "in_transit"}
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/status"
            async with self.session.put(url, json=status_update, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if 'message' in data:
                        self.log_result("Status Update (In Transit)", True)
                        return True
                    else:
                        self.log_result("Status Update (In Transit)", False, f"Unexpected response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Status Update (In Transit)", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Status Update (In Transit)", False, f"Exception: {str(e)}")
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

    # ========== NEW MAPBOX INTEGRATION TESTS ==========

    async def test_route_calculation(self):
        """Test route calculation between coordinates"""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        route_data = {
            "origin": SF_COORDINATES["pickup"],
            "destination": SF_COORDINATES["delivery"],
            "profile": "mapbox/driving-traffic",
            "steps": True,
            "alternatives": True
        }
        
        try:
            async with self.session.post(f"{API_BASE}/route/calculate", json=route_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success') and 'route' in data and 'duration' in data and 'distance' in data:
                        self.log_result("Route Calculation", True, f"Route: {data['distance']:.0f}m, {data['duration']:.0f}s")
                        return True
                    else:
                        self.log_result("Route Calculation", False, f"Invalid route response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Route Calculation", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Route Calculation", False, f"Exception: {str(e)}")
            return False

    async def test_route_optimization(self):
        """Test multi-stop route optimization"""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        coordinates = [
            SF_COORDINATES["pickup"],
            SF_COORDINATES["waypoint"],
            SF_COORDINATES["delivery"]
        ]
        
        try:
            async with self.session.post(f"{API_BASE}/route/optimize", 
                                       json={"coordinates": coordinates, "profile": "mapbox/driving-traffic"}, 
                                       headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success') and 'route' in data:
                        self.log_result("Route Optimization", True, f"Optimized route calculated")
                        return True
                    else:
                        self.log_result("Route Optimization", False, f"Invalid optimization response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Route Optimization", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Route Optimization", False, f"Exception: {str(e)}")
            return False

    async def test_geocoding(self):
        """Test address to coordinates conversion"""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        test_address = "Union Square, San Francisco, CA"
        
        try:
            async with self.session.post(f"{API_BASE}/geocode", 
                                       json={"address": test_address}, 
                                       headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success') and 'coordinate' in data:
                        coord = data['coordinate']
                        if 'latitude' in coord and 'longitude' in coord:
                            self.log_result("Geocoding", True, f"Address geocoded to {coord['latitude']:.4f}, {coord['longitude']:.4f}")
                            return True
                        else:
                            self.log_result("Geocoding", False, f"Invalid coordinate format: {coord}")
                            return False
                    else:
                        self.log_result("Geocoding", False, f"Geocoding failed: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Geocoding", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Geocoding", False, f"Exception: {str(e)}")
            return False

    async def test_reverse_geocoding(self):
        """Test coordinates to address conversion"""
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        coordinate = SF_COORDINATES["pickup"]
        
        try:
            async with self.session.post(f"{API_BASE}/reverse-geocode", 
                                       json={"coordinate": coordinate}, 
                                       headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success') and 'address' in data:
                        self.log_result("Reverse Geocoding", True, f"Coordinates converted to: {data['address'][:50]}...")
                        return True
                    else:
                        self.log_result("Reverse Geocoding", False, f"Reverse geocoding failed: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Reverse Geocoding", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Reverse Geocoding", False, f"Exception: {str(e)}")
            return False

    async def test_navigation_start(self):
        """Test starting navigation for a delivery"""
        if not self.test_delivery_id:
            self.log_result("Navigation Start", False, "Missing delivery ID")
            return False

        headers = {"Authorization": f"Bearer {self.driver_token}"}
        
        route_data = {
            "route_id": "test-route-123",
            "estimated_duration": 1800,  # 30 minutes
            "estimated_distance": 5000   # 5km
        }
        
        try:
            url = f"{API_BASE}/delivery/{self.test_delivery_id}/navigation/start"
            async with self.session.post(url, json=route_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success'):
                        self.log_result("Navigation Start", True)
                        return True
                    else:
                        self.log_result("Navigation Start", False, f"Navigation start failed: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Navigation Start", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Navigation Start", False, f"Exception: {str(e)}")
            return False

    async def test_navigation_progress(self):
        """Test updating navigation progress"""
        if not self.test_delivery_id:
            self.log_result("Navigation Progress", False, "Missing delivery ID")
            return False

        headers = {"Authorization": f"Bearer {self.driver_token}"}
        
        progress_data = {
            "distance_remaining": 2500,
            "duration_remaining": 900,
            "fraction_traveled": 0.5,
            "distance_traveled": 2500,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        try:
            url = f"{API_BASE}/delivery/{self.test_delivery_id}/progress"
            async with self.session.post(url, json=progress_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success'):
                        self.log_result("Navigation Progress", True)
                        return True
                    else:
                        self.log_result("Navigation Progress", False, f"Progress update failed: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Navigation Progress", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Navigation Progress", False, f"Exception: {str(e)}")
            return False

    async def test_delivery_completion(self):
        """Test completing a delivery"""
        if not self.test_delivery_id:
            self.log_result("Delivery Completion", False, "Missing delivery ID")
            return False

        headers = {"Authorization": f"Bearer {self.driver_token}"}
        
        try:
            url = f"{API_BASE}/delivery/{self.test_delivery_id}/complete"
            async with self.session.post(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success'):
                        self.log_result("Delivery Completion", True)
                        return True
                    else:
                        self.log_result("Delivery Completion", False, f"Completion failed: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Delivery Completion", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Delivery Completion", False, f"Exception: {str(e)}")
            return False

    async def test_driver_location_retrieval(self):
        """Test getting driver location"""
        if not self.driver_user:
            self.log_result("Driver Location Retrieval", False, "Missing driver user")
            return False

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        try:
            url = f"{API_BASE}/driver/{self.driver_user['id']}/location"
            async with self.session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    # Location might not exist yet, so success=false is acceptable
                    if 'success' in data:
                        self.log_result("Driver Location Retrieval", True, f"Location status: {data['success']}")
                        return True
                    else:
                        self.log_result("Driver Location Retrieval", False, f"Invalid response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Driver Location Retrieval", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Driver Location Retrieval", False, f"Exception: {str(e)}")
            return False

    async def test_tracking_link_creation(self):
        """Test creating customer tracking links"""
        if not self.test_delivery_id:
            self.log_result("Tracking Link Creation", False, "Missing delivery ID")
            return False

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        tracking_data = {
            "customer_email": "sarah.johnson@example.com"
        }
        
        try:
            url = f"{API_BASE}/deliveries/{self.test_delivery_id}/tracking"
            async with self.session.post(url, json=tracking_data, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success') and 'tracking_id' in data and 'tracking_url' in data:
                        self.tracking_id = data['tracking_id']
                        self.log_result("Tracking Link Creation", True, f"Tracking ID: {self.tracking_id}")
                        return True
                    else:
                        self.log_result("Tracking Link Creation", False, f"Invalid tracking response: {data}")
                        return False
                else:
                    error_data = await response.text()
                    self.log_result("Tracking Link Creation", False, f"Status: {response.status}, Response: {error_data}")
                    return False
        except Exception as e:
            self.log_result("Tracking Link Creation", False, f"Exception: {str(e)}")
            return False

    async def test_public_tracking(self):
        """Test public tracking endpoint (no auth required)"""
        if not self.tracking_id:
            self.log_result("Public Tracking", False, "Missing tracking ID")
            return False

        try:
            async with self.session.get(f"{API_BASE}/track/{self.tracking_id}") as response:
                if response.status == 200:
                    data = await response.json()
                    if 'delivery_id' in data and 'status' in data and 'pickup_location' in data and 'delivery_location' in data:
                        self.log_result("Public Tracking", True, f"Tracking data retrieved for delivery {data['delivery_id']}")
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
        """Test WebSocket connections for real-time tracking"""
        if not self.driver_user:
            self.log_result("WebSocket Connections", False, "Missing driver user")
            return False

        # Test driver WebSocket connection
        ws_url = f"{BACKEND_URL.replace('http', 'ws')}/ws/driver/{self.driver_user['id']}"
        
        try:
            async with websockets.connect(ws_url) as websocket:
                # Send a test location update via WebSocket
                test_message = {
                    "latitude": SF_COORDINATES["pickup"]["latitude"],
                    "longitude": SF_COORDINATES["pickup"]["longitude"],
                    "heading": 90.0,
                    "speed": 30.0,
                    "accuracy": 5.0,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                await websocket.send(json.dumps(test_message))
                
                # Wait for acknowledgment
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                response_data = json.loads(response)
                
                if response_data.get('type') == 'location_ack':
                    self.log_result("Driver WebSocket Connection", True)
                else:
                    self.log_result("Driver WebSocket Connection", False, f"Unexpected response: {response_data}")
                
        except Exception as e:
            self.log_result("Driver WebSocket Connection", False, f"Exception: {str(e)}")

        # Test customer WebSocket connection if tracking ID exists
        if self.tracking_id:
            customer_ws_url = f"{BACKEND_URL.replace('http', 'ws')}/ws/customer/{self.tracking_id}"
            
            try:
                async with websockets.connect(customer_ws_url) as websocket:
                    # Wait for initial data
                    initial_data = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    data = json.loads(initial_data)
                    
                    if data.get('type') == 'initial_data':
                        self.log_result("Customer WebSocket Connection", True)
                        return True
                    else:
                        self.log_result("Customer WebSocket Connection", True, "Connected but no initial data")
                        return True
                        
            except Exception as e:
                self.log_result("Customer WebSocket Connection", False, f"Exception: {str(e)}")
                return False
        else:
            self.log_result("Customer WebSocket Connection", False, "No tracking ID available")
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