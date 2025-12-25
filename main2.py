import pandas

import sqlite3
data = pandas.read_csv("SensorNodeData.csv")

data['timestamp'] = data['timestamp'].apply(lambda x: x.replace('T', ' '))
print(data.head())
connection = sqlite3.connect("Server/SensorNodeData.db")
cursor = connection.cursor()

data.to_sql("sensor_data", connection, if_exists="replace", index=False)

