import paho.mqtt.client as mqtt

BROKER = '192.168.1.111'
PORT = 1883
TOPIC = 'test/topic'

output_file = open('../SensorNodeData.csv', 'w')
output_file.write('Timestamp,AQI,Temperature,Humidity,Presence\n')

def on_connect(client, userdata, flags, reasonCode, properties):
    print("Connected with reasonCode:", reasonCode)
    client.subscribe(TOPIC)

def on_message(client, userdata, msg):
    payload = msg.payload.decode()
    print(payload)

client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

client.connect(BROKER, PORT, 60)
client.loop_forever()
