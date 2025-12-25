import asyncio
import copy

# --------------------
# Shared state
# --------------------
model = {"weight": 1.0}          # mock model
model_lock = asyncio.Lock()

# --------------------
# Prediction loop
# --------------------
async def predict_loop():
    while True:
        async with model_lock:
            m = model            # grab reference only
        print("🔮 Predict using weight:", m["weight"])
        await asyncio.sleep(1)

# --------------------
# Online training
# --------------------
async def online_training():
    global model

    while True:
        await asyncio.sleep(10)  # every 30 min in real life

        print("🧠 Training started")

        # ---- COPY ----
        async with model_lock:
            model_copy = copy.deepcopy(model)

        # ---- TRAIN (NO LOCK) ----
        await asyncio.sleep(3)   # simulate training
        model_copy["weight"] += 1

        # ---- SWAP ----
        async with model_lock:
            model = model_copy

        print("✅ Training finished, model swapped")

def example():
    predict_loop()
    return 1

# --------------------
# Main
# --------------------
async def main():
    asyncio.create_task(online_training())
    await predict_loop()         # runs forever

asyncio.run(main())
