#include <time.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// Analog and Digital Pin Config
#define LED_PIN 2
#define DHT_PIN 33
#define PIR_PIN 34
#define MQ135_PIN 35

// DHTTYPE Config
#define DHTTYPE DHT11 

// MQ-135 Config 
#define RL 1000.0        // 1k load resistor
#define R0 4700         // Clean Air Resistance
#define ADC_MAX 4095.0
#define RATIO_CLEAN  1.25
#define RATIO_DIRTY  0.4

// --- WI-FI CONFIG ---
const char* SSID = "Fixie";
const char* PASSWORD = "1234567890";

// --- MQTT Server Config ---
const char* MQTT_SERVER = "159.146.28.222";
const int MQTT_PORT = 23253;
const char* TOPIC = "sensors/data";

// --- Time Config --- 
const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.nist.gov";

const long GMT_OFFSET_SEC = 3 * 3600;
const int DAYLIGHT_OFFSET_SEC = 0;

// Global Variables
WiFiClient espClient;
PubSubClient client(espClient);
DHT dht(DHT_PIN, DHTTYPE);
int lastSecond;

// Proptypes
void pirRead(int *pres);
void mq135Read(float *aqi);
void dhtRead(float *temp, float *hum);

void setup_wifi();
void reconnect();
String getIsoTimestamp();
bool waitForTimeSync(uint32_t timeoutMs);

void publishPayload(float aqi, float temp, float hum, int pres);

void setup() {
  Serial.begin(115200);
  analogSetAttenuation(ADC_11db);

  pinMode(PIR_PIN, INPUT);
  pinMode(MQ135_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  delay(2000);
  Serial.println("Input Pins are Set Up...");

  
  setup_wifi();
  Serial.println("Wi-Fi Connection Succesfull...");
  
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2);
  Serial.println("Waiting for NTP sync...");
  if (waitForTimeSync(15000)) {
    Serial.println("NTP time synced.");
    lastSecond = -1;
  } else {
    Serial.println("NTP sync timed out - timestamps may be invalid until sync occurs.");
  }

  client.setServer(MQTT_SERVER, MQTT_PORT);
  
  digitalWrite(LED_PIN, HIGH);
  Serial.println("MQTT Server Connecion Succesfull...");  
  Serial.println("Waiting for Stabilization of sensors...");
  delay(60000);

  dht.begin();
  Serial.println("Sensors are Initialized Succcesfully...");
  Serial.println("Smart Sensor Node is Initialized Succesfully...");
}

void loop() {
  // Maintain Wi-Fi and MQTT connection
  if (!client.connected()) {
    reconnect();
  }
  client.loop(); // Keep MQTT Alive
  
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 1000)) {
    delay(200);
    return;
  }

  // Run once every 5 seconds
  if (timeinfo.tm_sec % 5 != 0 || timeinfo.tm_sec == lastSecond) {
    delay(100);
    return;
  }
  lastSecond = timeinfo.tm_sec;

  // Give Wi-Fi a Bit Time to Stablize
  delay(50);

  // Collect Sensor Readings
  int pres = -1;
  float aqi = -1;
  float temp = -1;
  float hum = -1;

  pirRead(&pres);
  mq135Read(&aqi);
  dhtRead(&temp, &hum);

  // Publish JSON Payload (ArduinoJson)
  publishPayload(aqi, temp, hum, pres);
}


void pirRead(int *pres){
  int val = digitalRead(PIR_PIN);
  if (val == LOW){
    *pres = 0;
  }
  else{
    *pres = 1;
  }
}

void mq135Read(float *aq) {
  const int samples = 30;
  uint32_t sum = 0;

  for (int i = 0; i < samples; i++) {
    sum += analogRead(MQ135_PIN);
    delay(5);
  }

  float adc = sum / (float)samples;

  // Safety check
  if (adc <= 0) {
    *aq = -1;
    return;
  }

  // Sensor resistance
  float rs = RL * (ADC_MAX / adc - 1.0);
  float ratio = rs / R0;

  // PRINT THESE TO SERIAL MONITOR
  Serial.print("Current RS: "); Serial.print(rs);
  Serial.print(" | Ratio: "); Serial.println(ratio);

  // Normalize...

  // Normalize Rs/R0 → 0–100
  float index = ((RATIO_CLEAN - ratio) / (RATIO_CLEAN - RATIO_DIRTY)) * 100.0;

  // Clamp hard
  if (index < 0) index = 0;
  if (index > 100) index = 100;

  *aq = index;
}

void dhtRead(float *temp, float *hum){
  // Read temperature as Celsius (the default)
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  

  // Check if any reads failed and exit early.
  if (isnan(t) || isnan(h)) {
    *temp = -1;
    *hum = -1;
    return;
  }

  *temp = t;
  *hum = h;
}

void setup_wifi() {
  delay(10);
  WiFi.begin(SSID, PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void reconnect() {
  while (!client.connected()) {
    digitalWrite(LED_PIN, LOW);
    String clientId = "ESP32-" + String((uint32_t)esp_random(), HEX);
    if (client.connect(clientId.c_str())) {
      digitalWrite(LED_PIN, HIGH);
    } else {
      delay(2000);
    }
  }
}


void publishPayload(float aqi, float temp, float hum, int pres) {
  StaticJsonDocument<256> doc;

  doc["timestamp"] = getIsoTimestamp();
  doc["aqi"]  = aqi;
  doc["temp"] = temp;
  doc["hum"]  = hum;
  doc["presence"] = pres;

  char payload[256];
  size_t n = serializeJson(doc, payload, sizeof(payload));
  client.publish(TOPIC, payload, n);
}

// Wait until SNTP sets a sane time (year >= 2020) or timeout (ms)
bool waitForTimeSync(uint32_t timeoutMs) {
  unsigned long start = millis();
  struct tm timeinfo;
  while (millis() - start < timeoutMs) {
    // getLocalTime is provided by ESP32 Arduino core and waits up to the passed timeout (ms)
    if (getLocalTime(&timeinfo, 1000)) {
      if (timeinfo.tm_year + 1900 >= 2020) return true;
    }
    delay(200);
  }
  return false;
}

// Return ISO-8601 timestamp ("" if not available)
String getIsoTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 1000)) {
    return String(""); // no valid time yet
  }
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buf);
}