from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import hashlib
import secrets
import json
from twilio.rest import Client
import jwt
from bson import ObjectId

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Secret
JWT_SECRET = "delivery_dispatch_secret_key_2024"

# Twilio client (will be configured when credentials are provided)
twilio_client = None

app = FastAPI(title="Delivery Dispatch API")
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.driver_connections: Dict[str, WebSocket] = {}
        self.admin_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket, client_type: str, client_id: str = None):
        await websocket.accept()
        if client_type == "driver" and client_id:
            self.driver_connections[client_id] = websocket
        elif client_type == "admin":
            self.admin_connections.append(websocket)
        else:
            connection_id = str(uuid.uuid4())
            self.active_connections[connection_id] = websocket
            return connection_id
    
    def disconnect(self, websocket: WebSocket, client_type: str = None, client_id: str = None):
        if client_type == "driver" and client_id:
            self.driver_connections.pop(client_id, None)
        elif client_type == "admin":
            if websocket in self.admin_connections:
                self.admin_connections.remove(websocket)
        else:
            # Remove from active connections
            for conn_id, conn in list(self.active_connections.items()):
                if conn == websocket:
                    self.active_connections.pop(conn_id, None)
                    break
    
    async def send_to_driver(self, driver_id: str, message: dict):
        if driver_id in self.driver_connections:
            await self.driver_connections[driver_id].send_text(json.dumps(message))
    
    async def send_to_admins(self, message: dict):
        for connection in self.admin_connections[:]:
            try:
                await connection.send_text(json.dumps(message))
            except:
                self.admin_connections.remove(connection)
    
    async def send_to_trackers(self, delivery_id: str, message: dict):
        # Send location updates to tracking clients
        for conn_id, connection in list(self.active_connections.items()):
            try:
                await connection.send_text(json.dumps(message))
            except:
                self.active_connections.pop(conn_id, None)

manager = ConnectionManager()

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    name: str
    phone: str
    role: str  # 'admin' or 'driver'
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    email: str
    name: str
    phone: str
    role: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class Delivery(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_name: str
    customer_phone: str
    pickup_address: str
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    delivery_address: str
    delivery_lat: Optional[float] = None
    delivery_lng: Optional[float] = None
    status: str = "created"  # created, assigned, in_progress, delivered, cancelled
    driver_id: Optional[str] = None
    tracking_token: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    assigned_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    notes: Optional[str] = None

class DeliveryCreate(BaseModel):
    customer_name: str
    customer_phone: str
    pickup_address: str
    delivery_address: str
    notes: Optional[str] = None

class DeliveryUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None

class LocationUpdate(BaseModel):
    delivery_id: str
    lat: float
    lng: float
    heading: Optional[float] = None
    speed: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class SMSRequest(BaseModel):
    phone_number: str
    message: str

# Helper functions
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    return hashlib.sha256(password.encode()).hexdigest() == hashed

def create_jwt_token(user_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        role = payload.get("role")
        
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        return {"id": user_id, "role": role, "email": user["email"], "name": user["name"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

def require_driver(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "driver":
        raise HTTPException(status_code=403, detail="Driver access required")
    return current_user

# Authentication endpoints
@api_router.post("/auth/register")
async def register(user: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user_dict = user.dict()
    user_dict["password_hash"] = hash_password(user_dict.pop("password"))
    user_obj = User(**user_dict)
    
    await db.users.insert_one(user_obj.dict())
    
    # Create JWT token
    token = create_jwt_token(user_obj.id, user_obj.role)
    
    return {
        "token": token,
        "user": {
            "id": user_obj.id,
            "email": user_obj.email,
            "name": user_obj.name,
            "role": user_obj.role
        }
    }

@api_router.post("/auth/login")
async def login(user: UserLogin):
    # Find user
    db_user = await db.users.find_one({"email": user.email})
    if not db_user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Verify password
    if not verify_password(user.password, db_user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Create JWT token
    token = create_jwt_token(db_user["id"], db_user["role"])
    
    return {
        "token": token,
        "user": {
            "id": db_user["id"],
            "email": db_user["email"],
            "name": db_user["name"],
            "role": db_user["role"]
        }
    }

# Delivery endpoints
@api_router.post("/deliveries", response_model=Delivery)
async def create_delivery(delivery: DeliveryCreate, admin: dict = Depends(require_admin)):
    delivery_dict = delivery.dict()
    delivery_obj = Delivery(**delivery_dict)
    
    await db.deliveries.insert_one(delivery_obj.dict())
    
    # Notify all admins about new delivery
    await manager.send_to_admins({
        "type": "new_delivery",
        "delivery": delivery_obj.dict()
    })
    
    return delivery_obj

@api_router.get("/deliveries", response_model=List[Delivery])
async def get_deliveries(current_user: dict = Depends(get_current_user)):
    if current_user["role"] == "admin":
        # Admins see all deliveries
        deliveries = await db.deliveries.find().sort("created_at", -1).to_list(1000)
    else:
        # Drivers see only their assigned deliveries
        deliveries = await db.deliveries.find({"driver_id": current_user["id"]}).sort("created_at", -1).to_list(1000)
    
    return [Delivery(**delivery) for delivery in deliveries]

@api_router.get("/deliveries/{delivery_id}")
async def get_delivery(delivery_id: str, current_user: dict = Depends(get_current_user)):
    delivery = await db.deliveries.find_one({"id": delivery_id})
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    # Check permissions
    if current_user["role"] == "driver" and delivery["driver_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return Delivery(**delivery)

@api_router.put("/deliveries/{delivery_id}/assign/{driver_id}")
async def assign_delivery(delivery_id: str, driver_id: str, admin: dict = Depends(require_admin)):
    # Check if driver exists
    driver = await db.users.find_one({"id": driver_id, "role": "driver"})
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Update delivery
    result = await db.deliveries.update_one(
        {"id": delivery_id},
        {
            "$set": {
                "driver_id": driver_id,
                "status": "assigned",
                "assigned_at": datetime.utcnow()
            }
        }
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    # Get updated delivery
    delivery = await db.deliveries.find_one({"id": delivery_id})
    
    # Notify driver about new assignment
    await manager.send_to_driver(driver_id, {
        "type": "delivery_assigned",
        "delivery": delivery
    })
    
    # Notify admins about assignment
    await manager.send_to_admins({
        "type": "delivery_assigned",
        "delivery": delivery,
        "driver": driver
    })
    
    return {"message": "Delivery assigned successfully"}

@api_router.put("/deliveries/{delivery_id}/status")
async def update_delivery_status(delivery_id: str, update: DeliveryUpdate, current_user: dict = Depends(get_current_user)):
    delivery = await db.deliveries.find_one({"id": delivery_id})
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    
    # Check permissions
    if current_user["role"] == "driver" and delivery["driver_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    update_data = {}
    if update.status:
        update_data["status"] = update.status
        
        if update.status == "in_progress":
            update_data["started_at"] = datetime.utcnow()
            # Send SMS to customer when delivery starts
            if delivery.get("customer_phone"):
                await send_tracking_sms(delivery["customer_phone"], delivery["tracking_token"])
        elif update.status == "delivered":
            update_data["completed_at"] = datetime.utcnow()
    
    if update.notes:
        update_data["notes"] = update.notes
    
    if update_data:
        await db.deliveries.update_one({"id": delivery_id}, {"$set": update_data})
        
        # Get updated delivery
        updated_delivery = await db.deliveries.find_one({"id": delivery_id})
        
        # Notify admins about status change
        await manager.send_to_admins({
            "type": "delivery_updated",
            "delivery": updated_delivery
        })
        
        # If status changed to in_progress, notify tracking clients
        if update.status == "in_progress":
            await manager.send_to_trackers(delivery_id, {
                "type": "delivery_started",
                "delivery_id": delivery_id
            })
    
    return {"message": "Delivery updated successfully"}

# Driver endpoints
@api_router.get("/drivers")
async def get_drivers(admin: dict = Depends(require_admin)):
    drivers = await db.users.find({"role": "driver"}).to_list(1000)
    return [{"id": driver["id"], "name": driver["name"], "email": driver["email"], "phone": driver["phone"]} for driver in drivers]

# Location tracking
@api_router.post("/locations")
async def update_location(location: LocationUpdate, driver: dict = Depends(require_driver)):
    # Store location in database
    location_data = location.dict()
    location_data["driver_id"] = driver["id"]
    await db.locations.insert_one(location_data)
    
    # Broadcast location to tracking clients and admins
    await manager.send_to_trackers(location.delivery_id, {
        "type": "location_update",
        "delivery_id": location.delivery_id,
        "lat": location.lat,
        "lng": location.lng,
        "heading": location.heading,
        "speed": location.speed,
        "timestamp": location.timestamp.isoformat()
    })
    
    # Also notify admins
    await manager.send_to_admins({
        "type": "location_update",
        "delivery_id": location.delivery_id,
        "driver_id": driver["id"],
        "lat": location.lat,
        "lng": location.lng,
        "heading": location.heading,
        "speed": location.speed,
        "timestamp": location.timestamp.isoformat()
    })
    
    return {"message": "Location updated"}

# Public tracking endpoint (no auth required)
@api_router.get("/track/{tracking_token}")
async def get_tracking_info(tracking_token: str):
    delivery = await db.deliveries.find_one({"tracking_token": tracking_token})
    if not delivery:
        raise HTTPException(status_code=404, detail="Tracking information not found")
    
    # Get latest location if delivery is in progress
    location = None
    if delivery["status"] == "in_progress" and delivery.get("driver_id"):
        location = await db.locations.find_one(
            {"delivery_id": delivery["id"]},
            sort=[("timestamp", -1)]
        )
    
    return {
        "delivery": {
            "id": delivery["id"],
            "customer_name": delivery["customer_name"],
            "pickup_address": delivery["pickup_address"],
            "delivery_address": delivery["delivery_address"],
            "status": delivery["status"],
            "created_at": delivery["created_at"],
            "started_at": delivery.get("started_at"),
            "completed_at": delivery.get("completed_at")
        },
        "location": location
    }

# SMS Integration
async def send_tracking_sms(phone_number: str, tracking_token: str):
    global twilio_client
    if not twilio_client:
        return False
    
    try:
        tracking_url = f"https://yourapp.com/track/{tracking_token}"  # Replace with actual domain
        message = f"Your delivery is on the way! Track your driver here: {tracking_url}"
        
        twilio_client.messages.create(
            body=message,
            from_="+1234567890",  # Replace with actual Twilio number
            to=phone_number
        )
        return True
    except Exception as e:
        print(f"SMS sending failed: {e}")
        return False

@api_router.post("/sms/send")
async def send_sms(sms: SMSRequest, admin: dict = Depends(require_admin)):
    global twilio_client
    if not twilio_client:
        raise HTTPException(status_code=400, detail="SMS service not configured")
    
    try:
        twilio_client.messages.create(
            body=sms.message,
            from_="+1234567890",  # Replace with actual Twilio number
            to=sms.phone_number
        )
        return {"message": "SMS sent successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SMS sending failed: {str(e)}")

# Configuration endpoint for Twilio
@api_router.post("/config/twilio")
async def configure_twilio(config: dict, admin: dict = Depends(require_admin)):
    global twilio_client
    try:
        account_sid = config.get("account_sid")
        auth_token = config.get("auth_token")
        
        if account_sid and auth_token:
            twilio_client = Client(account_sid, auth_token)
            return {"message": "Twilio configured successfully"}
        else:
            raise HTTPException(status_code=400, detail="Missing Twilio credentials")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Twilio configuration failed: {str(e)}")

# WebSocket endpoints
@api_router.websocket("/ws/driver/{driver_id}")
async def driver_websocket(websocket: WebSocket, driver_id: str):
    await manager.connect(websocket, "driver", driver_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "location_update":
                # Handle real-time location updates
                location = LocationUpdate(**message["data"])
                location_data = location.dict()
                location_data["driver_id"] = driver_id
                await db.locations.insert_one(location_data)
                
                # Broadcast to tracking clients and admins
                await manager.send_to_trackers(location.delivery_id, {
                    "type": "location_update",
                    "delivery_id": location.delivery_id,
                    "lat": location.lat,
                    "lng": location.lng,
                    "heading": location.heading,
                    "speed": location.speed,
                    "timestamp": location.timestamp.isoformat()
                })
                
                await manager.send_to_admins({
                    "type": "location_update",
                    "delivery_id": location.delivery_id,
                    "driver_id": driver_id,
                    "lat": location.lat,
                    "lng": location.lng,
                    "heading": location.heading,
                    "speed": location.speed,
                    "timestamp": location.timestamp.isoformat()
                })
    
    except WebSocketDisconnect:
        manager.disconnect(websocket, "driver", driver_id)

@api_router.websocket("/ws/admin")
async def admin_websocket(websocket: WebSocket):
    await manager.connect(websocket, "admin")
    try:
        while True:
            data = await websocket.receive_text()
            # Handle admin WebSocket messages if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket, "admin")

@api_router.websocket("/ws/track/{tracking_token}")
async def tracking_websocket(websocket: WebSocket, tracking_token: str):
    # Verify tracking token
    delivery = await db.deliveries.find_one({"tracking_token": tracking_token})
    if not delivery:
        await websocket.close(code=4004, reason="Invalid tracking token")
        return
    
    connection_id = await manager.connect(websocket, "tracking")
    try:
        while True:
            data = await websocket.receive_text()
            # Handle tracking WebSocket messages if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Include the router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Health check
@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "delivery-dispatch-api"}