# Use official Mosquitto image
FROM eclipse-mosquitto:2.0

# Create folders inside container for persistence & logs
RUN mkdir -p /mosquitto/config /mosquitto/data /mosquitto/log

# Copy default config
COPY mosquitto.conf /mosquitto/config/mosquitto.conf

# Expose MQTT default port
EXPOSE 1883

# Set default command to run Mosquitto
CMD ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
