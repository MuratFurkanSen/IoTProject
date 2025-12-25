import time
import subprocess

cmd = [
    "docker", "exec", "mosquitto", "mosquitto_pub",
    "-h", "192.168.1.111",
    "-p", "1883",
    "-t", "sensors/data",
    "-m", '{"aqi":55,"temp":24.2,"hum":48,"presence":1}'
]

for _ in range(115):
    subprocess.run(cmd)
    time.sleep(0.01)
