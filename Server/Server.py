# %%
# To Supress Unnecessary Warnings
import warnings
warnings.filterwarnings('ignore', category=FutureWarning)

# Asynchronicity Handlers
import asyncio
import threading

# Database Handlers
import sqlite3

# Deep Learning
from tensorflow.keras.optimizers import Adam

# Communication Modules
import paho.mqtt.client as mqtt
import websockets

# Utilities
import json
import joblib
from datetime import datetime
from tensorflow.keras.models import load_model, clone_model

# Custom Online Trainer Module
import LSTM_Online
# %%
# ==========================
# CONFIG
# ==========================

# Websocket
WS_HOST = '0.0.0.0'
WS_PORT = 8765

# MQTT
MQTT_BROKER = '192.168.1.111'
MQTT_PORT = 1883
MQTT_TOPIC = 'sensors/data'

# Database
DB_FILE = 'sensor_data.db'

# Offline Model Parameters - Others Pulled from LSTM_Online.py
OFFLINE_MODEL_PATH = '../Models&Scalers/LSTM/model.keras'
OFFLINE_SCALERS_PATH = '../Models&Scalers/LSTM/scaler_bundle.pkl'

# ==========================
# Time Indicators
# ==========================
last_incoming_data_time = datetime.now()
last_online_training_time = datetime.now()
# %%
# ==========================
# Asynchronicity Loops and Locks
# ==========================
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

model_lock = asyncio.Lock()
db_lock = threading.Lock()
buffer_lock = threading.Lock()
# %%
# Load offline model and scalers
model = load_model(OFFLINE_MODEL_PATH)

online_optimizer = Adam(learning_rate=LSTM_Online.ONLINE_LR, clipnorm=1.0)

model.compile(
    optimizer=online_optimizer,
    loss='mse',
    metrics=['mae']
)
print('Offline Model Loaded and Optimizer Re-Created')

scaler_bundle = joblib.load(OFFLINE_SCALERS_PATH)
input_scalers = scaler_bundle['input_scalers']
target_scalers = scaler_bundle['target_scalers']
print('Input&Output Scalers Loaded')

iqr_bounds = scaler_bundle['outlier_meta']['bounds']
print('Input&Output Scalers Loaded')

# Creating Rolling Buffer for Online Model
buffer = LSTM_Online.RollingBuffer(
    max_size=2880
)
print('Buffer Created.')
# %%
# ==========================
# DATABASE
# ==========================
db = sqlite3.connect(DB_FILE, check_same_thread=False)
cursor = db.cursor()

cursor.execute("""
               CREATE TABLE IF NOT EXISTS sensor_data
               (
                   timestamp TEXT PRIMARY KEY,
                   aqi       REAL,
                   temp      REAL,
                   hum       REAL,
                   presence  INTEGER
               )
               """)
db.commit()


def now_local():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def insert_row(data):
    with db_lock:
        cursor.execute("""
            INSERT OR REPLACE INTO sensor_data
            VALUES (?, ?, ?, ?, ?)
        """, (
            data['timestamp'],
            data['aqi'],
            data['temp'],
            data['hum'],
            data['presence']
        ))
        db.commit()


def query_range(start, end):
    with db_lock:
        cursor.execute("""
                       SELECT *
                       FROM sensor_data
                       WHERE timestamp BETWEEN ? AND ?
                       ORDER BY timestamp ASC
                       """, (start, end))
        rows = cursor.fetchall()

    return [
        {
            'timestamp': r[0],
            'aqi': r[1],
            'temp': r[2],
            'hum': r[3],
            'presence': r[4]
        }
        for r in rows
    ]
# %%
# ==========================
# PREDICTION
# ==========================
async def prediction():
    with buffer_lock:
        seq = LSTM_Online.build_prediction_data(buffer, input_scalers, iqr_bounds)

    async with model_lock:
        m = model
    pred = LSTM_Online.predict_future(m, seq)
    return pred
# %%
# ==========================
# ONLINE TRAINING
# ==========================
async def train_online():
    global model
    with buffer_lock:
        X_online, y_online = LSTM_Online.build_online_training_data(buffer, input_scalers, target_scalers, iqr_bounds)

    async with model_lock:
        model_copy = clone_model(model)
        model_copy.set_weights(model.get_weights())

    await asyncio.to_thread(
        LSTM_Online.fine_tune_model_online,
        model_copy, X_online, y_online
    )

    async with model_lock:
        model = model_copy
# %%
# ==========================
# ASYNC Function Handlers
# ==========================
async def handle_live_message(data):
    pred = await prediction()
    await broadcast({
        'type': 'live',
        'raw': data,
        'prediction': pred
    })
# %%
# ==========================
# WEBSOCKET
# ==========================
clients = set()


async def ws_handler(ws):
    clients.add(ws)
    print('Dashboard connected:', len(clients))

    try:
        async for msg in ws:
            req = json.loads(msg)

            # Dashboard requesting historical data
            if req['type'] == 'get_range':
                data = query_range(req['start'], req['end'])

                await ws.send(json.dumps({
                    'type': 'historical',
                    'raw': data,
                }))
    finally:
        clients.remove(ws)
        print('Dashboard disconnected:', len(clients))


async def broadcast(payload):
    dead = set()
    for client in clients:
        try:
            await client.send(json.dumps(payload))
        except:
            dead.add(client)
    clients.difference_update(dead)


async def ws_server():
    server = await websockets.serve(
        ws_handler,
        WS_HOST,
        WS_PORT,
        ping_interval=20,
        ping_timeout=20
    )

    print(f'WS running on ws://{WS_HOST}:{WS_PORT}')
    await server.wait_closed()
# %%
# ==========================
# MQTT
# ==========================
def on_message(client, userdata, msg):
    try:
        global last_incoming_data_time, last_online_training_time
        payload = json.loads(msg.payload.decode())
        curr_time = datetime.now()

        data = {
            'timestamp': payload.get('timestamp', now_local()),
            'aqi': payload.get('aqi', -1),
            'temp': payload.get('temp', -1),
            'hum': payload.get('hum', -1),
            'presence': payload.get('presence', -1)
        }
        with buffer_lock:
            buffer.append(data)
        insert_row(data)
        last_incoming_data_time = curr_time

        asyncio.run_coroutine_threadsafe(
            handle_live_message(data),
            loop
        )

        if curr_time - last_online_training_time > LSTM_Online.FINE_TUNE_INTERVAL and buffer.is_full():
            asyncio.run_coroutine_threadsafe(
                train_online(),
                loop
            )
            last_online_training_time = curr_time

    except Exception as e:
        print("MQTT error:", e)


mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.on_message = on_message
mqtt_client.connect(MQTT_BROKER, MQTT_PORT)
mqtt_client.subscribe(MQTT_TOPIC)


def mqtt_thread():
    mqtt_client.loop_forever()
# %%
# ==========================
# START
# ==========================
threading.Thread(target=mqtt_thread, daemon=True).start()
loop.run_until_complete(ws_server())