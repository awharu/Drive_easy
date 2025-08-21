import os
import uuid
import json
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import asyncio
import logging

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import JWTError, jwt
import redis

# Import Mapbox service
from mapbox_service import mapbox_service, RouteRequest, LocationUpdate, NavigationProgress, Coordinate

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "delivery_dispatch")
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Initialize FastAPI app
app = FastAPI(title="Delivery Driver Dispatch API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Database
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Redis for real-time data
try:
    redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True, socket_connect_timeout=1)
    redis_client.ping()
    logger.info("Redis connection established")
except Exception as e:
    logger.warning(f"Redis connection failed: {e}")
    redis_client = None

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.driver_connections: Dict[str, WebSocket] = {}
        self.customer_connections: Dict[str, WebSocket] = {}

    async def connect_driver(self, websocket: WebSocket, driver_id: str):
        await websocket.accept()
        self.driver_connections[driver_id] = websocket
        logger.info(f"Driver {driver_id} connected")

    async def connect_customer(self, websocket: WebSocket, tracking_id: str):
        await websocket.accept()
        self.customer_connections[tracking_id] = websocket
        logger.info(f"Customer tracking {tracking_id} connected")

    def disconnect_driver(self, driver_id: str):
        if driver_id in self.driver_connections:
            del self.driver_connections[driver_id]
            logger.info(f"Driver {driver_id} disconnected")

    def disconnect_customer(self, tracking_id: str):
        if tracking_id in self.customer_connections:
            del self.customer_connections[tracking_id]
            logger.info(f"Customer tracking {tracking_id} disconnected")

    async def broadcast_to_customers(self, driver_id: str, location_data: dict):
        # Find deliveries for this driver
        active_deliveries = await db.deliveries.find({"driver_id": driver_id, "status": {"$in": ["assigned", "picked_up", "in_transit"]}}).to_list(None)
        
        for delivery in active_deliveries:
            tracking_id = delivery.get("tracking_id")
            if tracking_id and tracking_id in self.customer_connections:
                try:
                    await self.customer_connections[tracking_id].send_text(json.dumps({
                        "type": "location_update",
                        "driver_location": location_data,
                        "delivery_id": str(delivery["_id"]),
                        "estimated_arrival": delivery.get("estimated_arrival")
                    }))
                except Exception as e:
                    logger.error(f"Error broadcasting to customer {tracking_id}: {e}")
                    self.disconnect_customer(tracking_id)

manager = ConnectionManager()

# Pydantic models
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone: str
    role: str  # 'admin' or 'driver'

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class User(BaseModel):
    id: str
    email: str
    name: str
    phone: str
    role: str

class DeliveryCreate(BaseModel):
    pickup_address: Optional[str] = None
    pickup_latitude: Optional[float] = None
    pickup_longitude: Optional[float] = None
    delivery_address: Optional[str] = None
    delivery_latitude: Optional[float] = None
    delivery_longitude: Optional[float] = None
    customer_name: str
    customer_phone: str
    customer_email: EmailStr
    notes: Optional[str] = None

class DeliveryAssign(BaseModel):
    driver_id: str

class DeliveryUpdate(BaseModel):
    status: str  # 'assigned', 'picked_up', 'in_transit', 'delivered'

class TrackingLinkCreate(BaseModel):
    customer_email: EmailStr

# Utility functions
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = await db.users.find_one({"_id": user_id})
    if user is None:
        raise credentials_exception
    return user

def generate_tracking_id(delivery_id: str, customer_email: str) -> str:
    """Generate a secure tracking ID"""
    salt = secrets.token_hex(16)
    data = f"{delivery_id}:{customer_email}:{salt}:{datetime.utcnow().timestamp()}"
    tracking_hash = hashlib.sha256(data.encode()).hexdigest()
    return tracking_hash[:16]

# API Routes

@app.get("/")
async def root():
    return {"message": "Delivery Driver Dispatch API", "version": "1.0.0"}

@app.get("/api/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# Authentication endpoints
@app.post("/api/auth/register")
async def register(user: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user_id = str(uuid.uuid4())
    hashed_password = get_password_hash(user.password)
    
    user_doc = {
        "_id": user_id,
        "email": user.email,
        "password": hashed_password,
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "created_at": datetime.utcnow(),
        "is_active": True
    }
    
    await db.users.insert_one(user_doc)
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_id, "email": user.email, "role": user.role},
        expires_delta=access_token_expires
    )
    
    return {
        "token": access_token,
        "user": {
            "id": user_id,
            "email": user.email,
            "name": user.name,
            "phone": user.phone,
            "role": user.role
        }
    }

@app.post("/api/auth/login")
async def login(user: UserLogin):
    db_user = await db.users.find_one({"email": user.email})
    if not db_user or not verify_password(user.password, db_user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not db_user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is disabled")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": db_user["_id"], "email": db_user["email"], "role": db_user["role"]},
        expires_delta=access_token_expires
    )
    
    return {
        "token": access_token,
        "user": {
            "id": db_user["_id"],
            "email": db_user["email"],
            "name": db_user["name"],
            "phone": db_user["phone"],
            "role": db_user["role"]
        }
    }

# Mapbox and Route endpoints
@app.post("/api/route/calculate")
async def calculate_route(route_request: RouteRequest, current_user: dict = Depends(get_current_user)):
    """Calculate a route between origin and destination"""
    try:
        route_response = await mapbox_service.calculate_route(route_request)
        return route_response.dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Route calculation error: {str(e)}")

@app.post("/api/route/optimize")
async def optimize_route(coordinates: List[dict], profile: str = "mapbox/driving-traffic", current_user: dict = Depends(get_current_user)):
    """Optimize a multi-stop route"""
    try:
        coords = [Coordinate(**coord) for coord in coordinates]
        route_response = await mapbox_service.optimize_multi_stop_route(coords, profile)
        return route_response.dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Route optimization error: {str(e)}")

@app.post("/api/geocode")
async def geocode_address(address: str, current_user: dict = Depends(get_current_user)):
    """Convert address to coordinates"""
    try:
        coordinate = await mapbox_service.geocode_address(address)
        if coordinate:
            return {"success": True, "coordinate": coordinate.dict()}
        else:
            return {"success": False, "error": "Address not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Geocoding error: {str(e)}")

@app.post("/api/reverse-geocode")
async def reverse_geocode(coordinate: dict, current_user: dict = Depends(get_current_user)):
    """Convert coordinates to address"""
    try:
        coord = Coordinate(**coordinate)
        address = await mapbox_service.reverse_geocode(coord)
        if address:
            return {"success": True, "address": address}
        else:
            return {"success": False, "error": "Address not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reverse geocoding error: {str(e)}")

# Delivery endpoints
@app.post("/api/deliveries")
async def create_delivery(delivery: DeliveryCreate, current_user: dict = Depends(get_current_user)):
    """Create a new delivery"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create deliveries")
    
    try:
        # Geocode addresses if coordinates not provided
        pickup_lat, pickup_lng = delivery.pickup_latitude, delivery.pickup_longitude
        delivery_lat, delivery_lng = delivery.delivery_latitude, delivery.delivery_longitude
        
        if delivery.pickup_address and (not pickup_lat or not pickup_lng):
            pickup_coord = await mapbox_service.geocode_address(delivery.pickup_address)
            if pickup_coord:
                pickup_lat, pickup_lng = pickup_coord.latitude, pickup_coord.longitude
        
        if delivery.delivery_address and (not delivery_lat or not delivery_lng):
            delivery_coord = await mapbox_service.geocode_address(delivery.delivery_address)
            if delivery_coord:
                delivery_lat, delivery_lng = delivery_coord.latitude, delivery_coord.longitude
        
        if not all([pickup_lat, pickup_lng, delivery_lat, delivery_lng]):
            raise HTTPException(status_code=400, detail="Unable to resolve pickup or delivery location")
        
        delivery_id = str(uuid.uuid4())
        delivery_doc = {
            "_id": delivery_id,
            "pickup_address": delivery.pickup_address,
            "pickup_latitude": pickup_lat,
            "pickup_longitude": pickup_lng,
            "delivery_address": delivery.delivery_address,
            "delivery_latitude": delivery_lat,
            "delivery_longitude": delivery_lng,
            "customer_name": delivery.customer_name,
            "customer_phone": delivery.customer_phone,
            "customer_email": delivery.customer_email,
            "notes": delivery.notes,
            "status": "pending",
            "created_by": current_user["_id"],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        await db.deliveries.insert_one(delivery_doc)
        
        return {
            "delivery_id": delivery_id,
            "message": "Delivery created successfully",
            "pickup_coordinates": {"latitude": pickup_lat, "longitude": pickup_lng},
            "delivery_coordinates": {"latitude": delivery_lat, "longitude": delivery_lng}
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating delivery: {str(e)}")

@app.get("/api/deliveries")
async def get_deliveries(current_user: dict = Depends(get_current_user)):
    """Get deliveries based on user role"""
    try:
        if current_user["role"] == "admin":
            # Admin sees all deliveries
            deliveries = await db.deliveries.find().sort([("created_at", -1)]).to_list(None)
        elif current_user["role"] == "driver":
            # Driver sees only assigned deliveries
            deliveries = await db.deliveries.find({"driver_id": current_user["_id"]}).sort([("created_at", -1)]).to_list(None)
        else:
            raise HTTPException(status_code=403, detail="Invalid user role")
        
        # Convert ObjectId to string for JSON serialization
        for delivery in deliveries:
            delivery["id"] = str(delivery["_id"])
            del delivery["_id"]
        
        return {"deliveries": deliveries}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching deliveries: {str(e)}")

@app.get("/api/deliveries/{delivery_id}")
async def get_delivery(delivery_id: str, current_user: dict = Depends(get_current_user)):
    """Get specific delivery details"""
    try:
        delivery = await db.deliveries.find_one({"_id": delivery_id})
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        
        # Check authorization
        if current_user["role"] == "driver" and delivery.get("driver_id") != current_user["_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        
        delivery["id"] = str(delivery["_id"])
        del delivery["_id"]
        
        return delivery
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching delivery: {str(e)}")

@app.post("/api/deliveries/{delivery_id}/assign")
async def assign_delivery(delivery_id: str, assignment: DeliveryAssign, current_user: dict = Depends(get_current_user)):
    """Assign delivery to a driver"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can assign deliveries")
    
    try:
        # Check if driver exists
        driver = await db.users.find_one({"_id": assignment.driver_id, "role": "driver"})
        if not driver:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        # Update delivery
        result = await db.deliveries.update_one(
            {"_id": delivery_id},
            {
                "$set": {
                    "driver_id": assignment.driver_id,
                    "driver_name": driver["name"],
                    "status": "assigned",
                    "assigned_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Delivery not found")
        
        return {"message": "Delivery assigned successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error assigning delivery: {str(e)}")

@app.put("/api/deliveries/{delivery_id}/status")
async def update_delivery_status(delivery_id: str, status_update: DeliveryUpdate, current_user: dict = Depends(get_current_user)):
    """Update delivery status"""
    try:
        delivery = await db.deliveries.find_one({"_id": delivery_id})
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        
        # Check authorization
        if current_user["role"] == "driver" and delivery.get("driver_id") != current_user["_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        elif current_user["role"] not in ["admin", "driver"]:
            raise HTTPException(status_code=403, detail="Invalid user role")
        
        update_data = {
            "status": status_update.status,
            "updated_at": datetime.utcnow()
        }
        
        # Add timestamp for specific status changes
        if status_update.status == "picked_up":
            update_data["picked_up_at"] = datetime.utcnow()
        elif status_update.status == "in_transit":
            update_data["in_transit_at"] = datetime.utcnow()
        elif status_update.status == "delivered":
            update_data["delivered_at"] = datetime.utcnow()
        
        await db.deliveries.update_one({"_id": delivery_id}, {"$set": update_data})
        
        return {"message": "Delivery status updated successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating delivery status: {str(e)}")

# Tracking endpoints
@app.post("/api/deliveries/{delivery_id}/tracking")
async def create_tracking_link(delivery_id: str, tracking_request: TrackingLinkCreate, current_user: dict = Depends(get_current_user)):
    """Create a customer tracking link"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create tracking links")
    
    try:
        delivery = await db.deliveries.find_one({"_id": delivery_id})
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        
        tracking_id = generate_tracking_id(delivery_id, tracking_request.customer_email)
        
        # Update delivery with tracking ID
        await db.deliveries.update_one(
            {"_id": delivery_id},
            {
                "$set": {
                    "tracking_id": tracking_id,
                    "tracking_created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        # Store tracking metadata in Redis if available
        if redis_client:
            tracking_metadata = {
                "delivery_id": delivery_id,
                "customer_email": tracking_request.customer_email,
                "created_at": datetime.utcnow().isoformat(),
                "expires_at": (datetime.utcnow() + timedelta(days=7)).isoformat()
            }
            redis_client.setex(f"tracking_meta:{tracking_id}", 604800, json.dumps(tracking_metadata))
        
        tracking_url = f"/track/{tracking_id}"
        return {
            "success": True,
            "tracking_id": tracking_id,
            "tracking_url": tracking_url
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating tracking link: {str(e)}")

@app.get("/api/track/{tracking_id}")
async def get_tracking_info(tracking_id: str):
    """Get tracking information (public endpoint)"""
    try:
        # Find delivery by tracking ID
        delivery = await db.deliveries.find_one({"tracking_id": tracking_id})
        if not delivery:
            raise HTTPException(status_code=404, detail="Tracking link not found")
        
        # Get current driver location if available
        driver_location = None
        navigation_progress = None
        
        if delivery.get("driver_id"):
            driver_location = await mapbox_service.get_driver_location(delivery["driver_id"])
            navigation_progress = await mapbox_service.get_navigation_progress(str(delivery["_id"]))
        
        return {
            "delivery_id": str(delivery["_id"]),
            "status": delivery["status"],
            "pickup_location": {
                "address": delivery.get("pickup_address"),
                "latitude": delivery["pickup_latitude"],
                "longitude": delivery["pickup_longitude"]
            },
            "delivery_location": {
                "address": delivery.get("delivery_address"),
                "latitude": delivery["delivery_latitude"],
                "longitude": delivery["delivery_longitude"]
            },
            "estimated_arrival": delivery.get("estimated_arrival").isoformat() if delivery.get("estimated_arrival") else None,
            "driver_location": driver_location,
            "navigation_progress": navigation_progress,
            "created_at": delivery["created_at"].isoformat(),
            "updated_at": delivery["updated_at"].isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting tracking info: {str(e)}")

# Driver location and navigation endpoints
@app.get("/api/driver/{driver_id}/location")
async def get_driver_location(driver_id: str, current_user: dict = Depends(get_current_user)):
    """Get current driver location"""
    try:
        location = await mapbox_service.get_driver_location(driver_id)
        if location:
            return {"success": True, "location": location}
        else:
            return {"success": False, "error": "Driver location not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting driver location: {str(e)}")

@app.post("/api/delivery/{delivery_id}/navigation/start")
async def start_navigation(delivery_id: str, route_data: dict, current_user: dict = Depends(get_current_user)):
    """Start navigation for a delivery"""
    try:
        delivery = await db.deliveries.find_one({"_id": delivery_id})
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        
        # Check authorization
        if current_user["role"] == "driver" and delivery.get("driver_id") != current_user["_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Update delivery status
        await db.deliveries.update_one(
            {"_id": delivery_id},
            {
                "$set": {
                    "status": "in_transit",
                    "navigation_started_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        # Store route data in Redis if available
        if redis_client:
            redis_client.setex(f"navigation_route:{delivery_id}", 3600, json.dumps(route_data))
        
        return {"success": True, "message": "Navigation started"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting navigation: {str(e)}")

@app.post("/api/delivery/{delivery_id}/progress")
async def update_navigation_progress(delivery_id: str, progress_data: dict, current_user: dict = Depends(get_current_user)):
    """Update navigation progress"""
    try:
        progress = NavigationProgress(delivery_id=delivery_id, **progress_data)
        success = await mapbox_service.store_navigation_progress(progress)
        
        if success:
            # Update ETA in database
            new_eta = datetime.utcnow() + timedelta(seconds=progress.duration_remaining)
            await db.deliveries.update_one(
                {"_id": delivery_id},
                {
                    "$set": {
                        "estimated_arrival": new_eta,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            return {"success": True, "message": "Progress updated"}
        else:
            return {"success": False, "error": "Failed to update progress"}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating progress: {str(e)}")

@app.post("/api/delivery/{delivery_id}/complete")
async def complete_delivery(delivery_id: str, current_user: dict = Depends(get_current_user)):
    """Mark delivery as completed"""
    try:
        # Update delivery status
        await db.deliveries.update_one(
            {"_id": delivery_id},
            {
                "$set": {
                    "status": "delivered",
                    "delivered_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        # Clean up Redis data
        if redis_client:
            redis_client.delete(f"navigation_route:{delivery_id}")
            redis_client.delete(f"navigation_progress:{delivery_id}")
        
        return {"success": True, "message": "Delivery completed"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error completing delivery: {str(e)}")

# WebSocket endpoints
@app.websocket("/ws/driver/{driver_id}")
async def driver_websocket(websocket: WebSocket, driver_id: str):
    await manager.connect_driver(websocket, driver_id)
    try:
        while True:
            data = await websocket.receive_text()
            location_data = json.loads(data)
            
            # Create location update object
            location_update = LocationUpdate(
                driver_id=driver_id,
                **location_data
            )
            
            # Store location update
            success = await mapbox_service.store_location_update(location_update)
            
            if success:
                # Broadcast to customers tracking this driver
                await manager.broadcast_to_customers(driver_id, location_data)
                
                # Send acknowledgment back to driver
                await websocket.send_text(json.dumps({
                    "type": "location_ack",
                    "timestamp": datetime.utcnow().isoformat(),
                    "status": "processed"
                }))
            else:
                await websocket.send_text(json.dumps({
                    "type": "location_error",
                    "message": "Failed to process location update"
                }))
                
    except WebSocketDisconnect:
        manager.disconnect_driver(driver_id)

@app.websocket("/ws/customer/{tracking_id}")
async def customer_websocket(websocket: WebSocket, tracking_id: str):
    await manager.connect_customer(websocket, tracking_id)
    try:
        # Send initial tracking data
        delivery = await db.deliveries.find_one({"tracking_id": tracking_id})
        if delivery and delivery.get("driver_id"):
            driver_location = await mapbox_service.get_driver_location(delivery["driver_id"])
            navigation_progress = await mapbox_service.get_navigation_progress(str(delivery["_id"]))
            
            if driver_location or navigation_progress:
                await websocket.send_text(json.dumps({
                    "type": "initial_data",
                    "driver_location": driver_location,
                    "navigation_progress": navigation_progress,
                    "delivery_status": delivery["status"]
                }))
        
        # Keep connection alive
        while True:
            await websocket.receive_text()
            
    except WebSocketDisconnect:
        manager.disconnect_customer(tracking_id)

# Driver management endpoints
@app.get("/api/drivers")
async def get_drivers(current_user: dict = Depends(get_current_user)):
    """Get list of drivers (admin only)"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access driver list")
    
    try:
        drivers = await db.users.find({"role": "driver", "is_active": True}).to_list(None)
        
        # Remove sensitive information and convert ObjectId
        for driver in drivers:
            driver["id"] = str(driver["_id"])
            del driver["_id"]
            del driver["password"]
        
        return {"drivers": drivers}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching drivers: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)