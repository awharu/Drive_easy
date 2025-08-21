"""
Mapbox integration service for delivery dispatch app
Handles route calculation, real-time tracking, and navigation services
"""

import os
import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from pydantic import BaseModel
import redis
from mapbox import Directions, Geocoder
import requests
from geojson import Point, Feature, LineString
import math
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/backend/.env')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Mapbox configuration
MAPBOX_ACCESS_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN")
if not MAPBOX_ACCESS_TOKEN:
    raise ValueError("MAPBOX_ACCESS_TOKEN environment variable is required")

# Initialize Mapbox clients
directions_client = Directions(access_token=MAPBOX_ACCESS_TOKEN)
geocoder_client = Geocoder(access_token=MAPBOX_ACCESS_TOKEN)

# Redis client for caching
try:
    redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True, socket_connect_timeout=1)
    redis_client.ping()
    logger.info("Redis connection established")
except Exception as e:
    logger.warning(f"Redis connection failed: {e}. Caching will be disabled.")
    redis_client = None

class Coordinate(BaseModel):
    longitude: float
    latitude: float

class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    waypoints: Optional[List[Coordinate]] = []
    profile: str = "mapbox/driving-traffic"
    steps: bool = True
    voice_instructions: bool = True
    banner_instructions: bool = True
    alternatives: bool = True
    overview: str = "full"

class RouteResponse(BaseModel):
    success: bool
    route: Optional[Dict[str, Any]] = None
    alternatives: Optional[List[Dict[str, Any]]] = []
    duration: Optional[float] = None
    distance: Optional[float] = None
    geometry: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class LocationUpdate(BaseModel):
    driver_id: str
    latitude: float
    longitude: float
    heading: Optional[float] = None
    speed: Optional[float] = None
    accuracy: Optional[float] = None
    altitude: Optional[float] = None
    timestamp: str

class NavigationProgress(BaseModel):
    delivery_id: str
    distance_remaining: float
    duration_remaining: float
    fraction_traveled: float
    distance_traveled: float
    current_step: Optional[Dict[str, Any]] = None
    timestamp: str

class MapboxService:
    def __init__(self):
        self.directions = directions_client
        self.geocoder = geocoder_client
        self.redis = redis_client
        
    async def calculate_route(self, route_request: RouteRequest) -> RouteResponse:
        """Calculate a route between origin and destination with optional waypoints"""
        try:
            # Build GeoJSON features list
            features = []
            
            # Add origin
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [route_request.origin.longitude, route_request.origin.latitude]
                }
            })
            
            # Add waypoints if provided
            for waypoint in route_request.waypoints:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [waypoint.longitude, waypoint.latitude]
                    }
                })
            
            # Add destination
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [route_request.destination.longitude, route_request.destination.latitude]
                }
            })
            
            # Check cache first
            cache_key = f"route:{hash(str(features))}:{route_request.profile}"
            if self.redis:
                cached_route = self.redis.get(cache_key)
                if cached_route:
                    logger.info("Retrieved route from cache")
                    return RouteResponse(**json.loads(cached_route))
            
            # Make API request
            response = self.directions.directions(
                features=features,
                profile=route_request.profile,
                steps=route_request.steps,
                alternatives=route_request.alternatives,
                overview=route_request.overview,
                geometries='geojson'
            )
            
            if response.status_code == 200:
                route_data = response.json()
                
                if route_data.get('routes'):
                    main_route = route_data['routes'][0]
                    alternatives = route_data['routes'][1:] if len(route_data['routes']) > 1 else []
                    
                    result = RouteResponse(
                        success=True,
                        route=main_route,
                        alternatives=alternatives,
                        duration=main_route.get('duration'),
                        distance=main_route.get('distance'),
                        geometry=main_route.get('geometry')
                    )
                    
                    # Cache the result for 30 minutes
                    if self.redis:
                        self.redis.setex(cache_key, 1800, result.json())
                    
                    return result
                else:
                    return RouteResponse(success=False, error="No routes found")
            else:
                error_msg = f"Mapbox API error: {response.status_code}"
                logger.error(error_msg)
                return RouteResponse(success=False, error=error_msg)
                
        except Exception as e:
            error_msg = f"Route calculation error: {str(e)}"
            logger.error(error_msg)
            return RouteResponse(success=False, error=error_msg)

    async def optimize_multi_stop_route(self, coordinates: List[Coordinate], profile: str = "mapbox/driving-traffic") -> RouteResponse:
        """Optimize a route with multiple stops using Mapbox Optimization API"""
        try:
            coords_list = [[coord.longitude, coord.latitude] for coord in coordinates]
            
            # Use Mapbox Optimization API (note: requires a different endpoint)
            optimization_url = f"https://api.mapbox.com/optimized-trips/v1/{profile.replace('mapbox/', '')}"
            
            params = {
                'coordinates': ';'.join([f"{coord[0]},{coord[1]}" for coord in coords_list]),
                'access_token': MAPBOX_ACCESS_TOKEN,
                'steps': 'true',
                'geometries': 'geojson',
                'overview': 'full'
            }
            
            response = requests.get(optimization_url, params=params)
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get('trips'):
                    optimized_trip = data['trips'][0]
                    
                    return RouteResponse(
                        success=True,
                        route=optimized_trip,
                        duration=optimized_trip.get('duration'),
                        distance=optimized_trip.get('distance'),
                        geometry=optimized_trip.get('geometry')
                    )
                else:
                    return RouteResponse(success=False, error="No optimized trips found")
            else:
                error_msg = f"Optimization API error: {response.status_code}"
                logger.error(error_msg)
                return RouteResponse(success=False, error=error_msg)
                
        except Exception as e:
            error_msg = f"Route optimization error: {str(e)}"
            logger.error(error_msg)
            return RouteResponse(success=False, error=error_msg)

    async def geocode_address(self, address: str) -> Optional[Coordinate]:
        """Convert address to coordinates using Mapbox Geocoding API"""
        try:
            response = self.geocoder.forward(address, limit=1)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('features'):
                    feature = data['features'][0]
                    coords = feature['geometry']['coordinates']
                    return Coordinate(longitude=coords[0], latitude=coords[1])
            
            return None
            
        except Exception as e:
            logger.error(f"Geocoding error: {str(e)}")
            return None

    async def reverse_geocode(self, coordinate: Coordinate) -> Optional[str]:
        """Convert coordinates to address using Mapbox Reverse Geocoding API"""
        try:
            response = self.geocoder.reverse(
                lon=coordinate.longitude,
                lat=coordinate.latitude,
                limit=1
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('features'):
                    feature = data['features'][0]
                    return feature.get('place_name', '')
            
            return None
            
        except Exception as e:
            logger.error(f"Reverse geocoding error: {str(e)}")
            return None

    def calculate_distance(self, coord1: Coordinate, coord2: Coordinate) -> float:
        """Calculate distance between two coordinates using Haversine formula (in meters)"""
        R = 6371000  # Earth's radius in meters
        
        lat1_rad = math.radians(coord1.latitude)
        lat2_rad = math.radians(coord2.latitude)
        delta_lat = math.radians(coord2.latitude - coord1.latitude)
        delta_lon = math.radians(coord2.longitude - coord1.longitude)
        
        a = (math.sin(delta_lat / 2) ** 2 +
             math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c

    def calculate_bearing(self, coord1: Coordinate, coord2: Coordinate) -> float:
        """Calculate bearing from coord1 to coord2 in degrees"""
        lat1_rad = math.radians(coord1.latitude)
        lat2_rad = math.radians(coord2.latitude)
        delta_lon = math.radians(coord2.longitude - coord1.longitude)
        
        y = math.sin(delta_lon) * math.cos(lat2_rad)
        x = (math.cos(lat1_rad) * math.sin(lat2_rad) -
             math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon))
        
        bearing = math.atan2(y, x)
        return (math.degrees(bearing) + 360) % 360

    async def store_location_update(self, location: LocationUpdate) -> bool:
        """Store driver location update in Redis"""
        try:
            if not self.redis:
                return False
                
            # Create enhanced location data
            location_data = {
                "driver_id": location.driver_id,
                "latitude": location.latitude,
                "longitude": location.longitude,
                "heading": location.heading,
                "speed": location.speed,
                "accuracy": location.accuracy,
                "altitude": location.altitude,
                "timestamp": location.timestamp,
                "processed_at": datetime.utcnow().isoformat(),
                "geojson": Feature(
                    geometry=Point((location.longitude, location.latitude)),
                    properties={
                        "driver_id": location.driver_id,
                        "timestamp": location.timestamp,
                        "heading": location.heading,
                        "speed": location.speed,
                        "accuracy": location.accuracy
                    }
                ).__geo_interface__
            }
            
            # Store in Redis with 5-minute expiry
            redis_key = f"driver_location:{location.driver_id}"
            self.redis.setex(redis_key, 300, json.dumps(location_data))
            
            # Also store in location history
            history_key = f"driver_history:{location.driver_id}"
            self.redis.lpush(history_key, json.dumps(location_data))
            self.redis.ltrim(history_key, 0, 99)  # Keep last 100 locations
            self.redis.expire(history_key, 3600)  # 1-hour expiry for history
            
            return True
            
        except Exception as e:
            logger.error(f"Error storing location update: {str(e)}")
            return False

    async def get_driver_location(self, driver_id: str) -> Optional[Dict[str, Any]]:
        """Get current driver location from Redis"""
        try:
            if not self.redis:
                return None
                
            redis_key = f"driver_location:{driver_id}"
            location_data = self.redis.get(redis_key)
            
            if location_data:
                return json.loads(location_data)
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting driver location: {str(e)}")
            return None

    async def get_driver_location_history(self, driver_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get driver location history from Redis"""
        try:
            if not self.redis:
                return []
                
            history_key = f"driver_history:{driver_id}"
            history_data = self.redis.lrange(history_key, 0, limit - 1)
            
            return [json.loads(location) for location in history_data]
            
        except Exception as e:
            logger.error(f"Error getting driver location history: {str(e)}")
            return []

    async def calculate_eta(self, origin: Coordinate, destination: Coordinate, traffic_profile: bool = True) -> Optional[float]:
        """Calculate estimated time of arrival in seconds"""
        try:
            profile = "mapbox/driving-traffic" if traffic_profile else "mapbox/driving"
            
            route_request = RouteRequest(
                origin=origin,
                destination=destination,
                profile=profile,
                steps=False,
                voice_instructions=False,
                banner_instructions=False
            )
            
            route_response = await self.calculate_route(route_request)
            
            if route_response.success and route_response.duration:
                return route_response.duration
            
            return None
            
        except Exception as e:
            logger.error(f"Error calculating ETA: {str(e)}")
            return None

    def is_location_on_route(self, current_location: Coordinate, route_geometry: Dict[str, Any], tolerance_meters: float = 100) -> bool:
        """Check if current location is on the planned route within tolerance"""
        try:
            if not route_geometry or route_geometry.get('type') != 'LineString':
                return False
            
            coordinates = route_geometry.get('coordinates', [])
            
            for route_coord in coordinates:
                route_point = Coordinate(longitude=route_coord[0], latitude=route_coord[1])
                distance = self.calculate_distance(current_location, route_point)
                
                if distance <= tolerance_meters:
                    return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking location on route: {str(e)}")
            return False

    async def store_navigation_progress(self, progress: NavigationProgress) -> bool:
        """Store navigation progress in Redis"""
        try:
            if not self.redis:
                return False
                
            progress_key = f"navigation_progress:{progress.delivery_id}"
            progress_data = progress.dict()
            progress_data["updated_at"] = datetime.utcnow().isoformat()
            
            # Store with 10-minute expiry
            self.redis.setex(progress_key, 600, json.dumps(progress_data))
            
            return True
            
        except Exception as e:
            logger.error(f"Error storing navigation progress: {str(e)}")
            return False

    async def get_navigation_progress(self, delivery_id: str) -> Optional[Dict[str, Any]]:
        """Get navigation progress from Redis"""
        try:
            if not self.redis:
                return None
                
            progress_key = f"navigation_progress:{delivery_id}"
            progress_data = self.redis.get(progress_key)
            
            if progress_data:
                return json.loads(progress_data)
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting navigation progress: {str(e)}")
            return None

# Initialize the service
mapbox_service = MapboxService()