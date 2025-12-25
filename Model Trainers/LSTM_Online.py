# %%
# To Supress Unnecessary Warnings
import warnings

warnings.filterwarnings('ignore', category=FutureWarning)

# Data Processing
import numpy as np
import pandas as pd

# Data Structures & Utilities
from datetime import datetime, timedelta
import joblib
from collections import deque
from tensorflow.keras.models import load_model

# Deep Learning
from tensorflow.keras.optimizers import Adam

# Visualization
import matplotlib.pyplot as plt
import seaborn as sns
# %%
# Incoming Sensor Data
SENSOR_DATA_COLUMNS = ['Timestamp', 'AQI', 'Temp', 'Hum', 'Pres']

# Data Preprocessing Capping Outlier Columns
OUTLIER_COLUMNS = ['AQI', 'Temp', 'Hum']

# Model Parameters

NUMERIC_INPUT_FEATURES = ['AQI', 'Temp', 'Hum', 'Pres']
INPUT_FEATURES = ['AQI', 'Temp', 'Hum', 'Pres', 'hour_sin', 'hour_cos']
TARGET_FEATURES = ['AQI', 'Temp', 'Hum']

NUM_FEATURES = len(INPUT_FEATURES)

SEQ_LEN = 120  # Model Input Sequence Length
HORIZON_ORDER = ['1min', '5min', '15min']
HORIZONS = {
    '1min': 12,
    '5min': 60,
    '15min': 180
}

# Offline Model Parameters
OFFLINE_MODEL_PATH = '../Models&Scalers/LSTM/model.keras'
OFFLINE_SCALERS_PATH = '../Models&Scalers/LSTM/scaler_bundle.pkl'

# Prediction Parameters
PREDICTION_INTERVAL = 5  # seconds

# Fine-tuning Parameters
ONLINE_LR = 0.001
FINE_TUNE_INTERVAL = timedelta(minutes=30)  # 30 min

ONLINE_EPOCHS = 1
ONLINE_BATCH_SIZE = 32
# %%
class RollingBuffer:
    max_size = None
    def __init__(self, max_size):
        self.buffer = deque(maxlen=max_size)
        self.max_size = max_size

    def append(self, sample):
        """
        sample: array-like of shape (num_features,)
        """
        self.buffer.append(sample)

    def __len__(self):
        return len(self.buffer)
    
    def is_full(self):
        return len(self.buffer) == self.max_size

    def get_last_n(self, n):
        """
        Returns last n samples as numpy array
        Shape: (n, num_features)
        """
        if len(self.buffer) < n:
            raise ValueError('Not enough data in buffer')

        return np.array(list(self.buffer)[-n:])
# %%
def read_sensor_data():
    """
    Simulated sensor input.
    Replace it later with real ESP32 / MQTT / serial input.
    """
    timestamp = datetime.now().isoformat()
    aqi = np.random.uniform(10, 150)
    temp = np.random.uniform(18, 30)
    humidity = np.random.uniform(30, 70)
    pres = np.random.randint(0, 2)

    return [timestamp, aqi, temp, humidity, pres]
# %%
def cap_outliers_iqr(df, columns, bounds):
    df = df.copy()

    for col in columns:
        lower = bounds[col]['lower']
        upper = bounds[col]['upper']

        df[col] = df[col].clip(lower=lower, upper=upper)

    return df
# %%
def process_raw_sensor_data(df, bounds):
    # Capping Outlier Columns
    df = cap_outliers_iqr(df, OUTLIER_COLUMNS, bounds)

    # Add Hourly Features
    df['hour_sin'] = np.sin(2 * np.pi * df['Timestamp'].dt.hour / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['Timestamp'].dt.hour / 24)

    return df
# %%
def build_lstm_sequences(df):
    """
    Builds LSTM input sequences and multi-horizon targets.

    Args:
        df (pd.DataFrame): Must contain INPUT_FEATURES + TARGET_FEATURES
    Returns:
        X (np.ndarray): shape (num_sequences, SEQ_LEN, num_input_features)
        y (np.ndarray): shape (num_sequences, num_targets)
    """
    X, y = [], []

    x_data = df[INPUT_FEATURES].values
    y_data = df[TARGET_FEATURES].values

    max_horizon = max(HORIZONS[h] for h in HORIZON_ORDER)

    for i in range(SEQ_LEN, len(df) - max_horizon):
        # ---- Input sequence ----
        X.append(x_data[i - SEQ_LEN:i])

        # ---- Target vector (feature-major, explicit horizons) ----
        target = []
        for col_idx in range(len(TARGET_FEATURES)):
            for h in HORIZON_ORDER:
                target.append(y_data[i + HORIZONS[h], col_idx])

        y.append(target)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)
# %%
def build_prediction_data(buffer, input_scalers, bounds):
    """
    Returns shape: (1, SEQ_LEN, NUM_INPUT_FEATURES)
    """
    df = pd.DataFrame(buffer.get_last_n(SEQ_LEN), columns=SENSOR_DATA_COLUMNS)
    df['Timestamp'] = pd.to_datetime(df['Timestamp'])
    df[NUMERIC_INPUT_FEATURES] = df[NUMERIC_INPUT_FEATURES].apply(pd.to_numeric, errors='coerce')

    df = process_raw_sensor_data(df, bounds)
    X = df[INPUT_FEATURES].values[np.newaxis, :, :]

    # Scale inputs

    for i, scaler in enumerate(input_scalers):
        X[:, :, i] = scaler.transform(X[:, :, i].reshape(-1, 1)).reshape(1, SEQ_LEN)

    return X
# %%
def build_online_training_data(buffer, input_scalers, target_scalers, bounds):
    """
    Builds X, y from the current buffer for online fine-tuning
    """
    if len(buffer) < SEQ_LEN + max(HORIZONS.values()):
        return None, None

    df = pd.DataFrame(
        list(buffer.buffer),
        columns=SENSOR_DATA_COLUMNS
    )
    df['Timestamp'] = pd.to_datetime(df['Timestamp'])
    df[NUMERIC_INPUT_FEATURES] = df[NUMERIC_INPUT_FEATURES].apply(pd.to_numeric, errors='coerce')

    df = process_raw_sensor_data(df, bounds)
    X_online, y_online = build_lstm_sequences(df)

    # Inputs
    for i, scaler in enumerate(input_scalers):
        X_online[:, :, i] = scaler.transform(X_online[:, :, i].reshape(-1, 1)).reshape(X_online.shape[0], SEQ_LEN)

    # Targets
    for i, scaler in enumerate(target_scalers):
        y_online[:, i] = scaler.transform(y_online[:, i].reshape(-1, 1)).flatten()

    return X_online, y_online
# %%
def predict_future(model, seq):
    y_pred = model.predict(seq, verbose=0)

    for i, scaler in enumerate(target_scalers):
        y_pred[:, i] = scaler.inverse_transform(
            y_pred[:, i].reshape(-1, 1)
        ).flatten()

    return y_pred.flatten()
# %%
def fine_tune_model_online(model, X_online, y_online):
    if X_online is None:
        return

    model.fit(
        X_online,
        y_online,
        epochs=ONLINE_EPOCHS,
        batch_size=ONLINE_BATCH_SIZE,
        shuffle=False,
    )
# %%
if __name__ == '__main__':
    # Load offline model and scalers
    model = load_model(OFFLINE_MODEL_PATH)

    online_optimizer = Adam(learning_rate=ONLINE_LR, clipnorm=1.0)

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

    # Creating Rolling Buffer
    buffer_local = RollingBuffer(
        max_size=2880
    )
    print('Buffer Created.')
# %%
"""
NOT USED
if __name__ == '__main__':
    print('🚀 Live inference + online learning running...')
    last_fine_tune_time = time.time() - 1000000
    for i in range(10000):
        buffer.append(read_sensor_data())
    try:
        while True:
            current_time = time.time()

            # Gathering New Sample
            sample = read_sensor_data()
            buffer.append(sample)

            # ---- FAST LOOP (5s inference) ----
            if len(buffer) >= SEQ_LEN:
                seq = build_prediction_data(buffer, input_scalers, iqr_bounds)
                pred = predict_future(model, seq)

                print('🔮 Prediction:')
                print(f' AQI  1m / 5m / 15m : {pred[0]:.1f}, {pred[1]:.1f}, {pred[2]:.1f}')
                print(f' Temp 1m / 5m / 15m: {pred[3]:.1f}, {pred[4]:.1f}, {pred[5]:.1f}')
                print(f' Hum  1m / 5m / 15m: {pred[6]:.1f}, {pred[7]:.1f}, {pred[8]:.1f}')
            else:
                print('Waiting for enough data in buffer...')

            # ---- SLOW LOOP (5 min fine-tune) ----
            if current_time - last_fine_tune_time >= FINE_TUNE_INTERVAL:
                print('🧠 Online fine-tuning started...')

                X_online, y_online = build_online_training_data(buffer, input_scalers, target_scalers, iqr_bounds)
                fine_tune_model_online(model, X_online, y_online)

                last_fine_tune_time = current_time
                print('✅ Online fine-tuning completed')

            time.sleep(PREDICTION_INTERVAL)
            break

    except KeyboardInterrupt:
        print('\nSystem stopped.')
"""
-1
# %%
