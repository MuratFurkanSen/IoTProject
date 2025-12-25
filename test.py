import time
import subprocess

cmd = [
    "docker", "exec", "mosquitto", "mosquitto_pub",
    "-h", "192.168.1.111",
    "-p", "1883",
    "-t", "sensors/data",
    "-m", '{"aqi":0.80,"temp":25,"hum":65,"presence":1}'
]

for _ in range(20):
    subprocess.run(cmd)
    time.sleep(0.01)
