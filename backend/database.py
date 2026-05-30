import motor.motor_asyncio
import os
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = "mongodb://localhost:27017"
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "ai_data_analyst")

client = motor.motor_asyncio.AsyncIOMotorClient(MONGODB_URI)
database = client[MONGODB_DB_NAME]


async def connect_to_mongo():
    try:
        await client.admin.command("ping")
        print("✅ LOCAL DATABASE CONNECTED SUCCESSFULLY!")
        return database
    except Exception:
        return None


async def close_mongo_connection() -> None:
    global client, database

    if client is not None:
        client.close()

    client = None
    database = None


async def get_database():
    return database