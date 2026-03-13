# HA Packages — Ray's Berry Farm

These files are mounted into Home Assistant at `/config/packages/` via docker-compose.

## Activating Packages in HA

Add this to your `ha-config/configuration.yaml` (one-time setup):

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Then restart HA: Settings → System → Restart.

## Files

### `rainpoint.yaml`
Full integration for the RainPoint BLE Soil Moisture & Temperature sensor:
- Template sensors: moisture status (DRY / OK / WET), soil VPD estimate
- Configurable dry/wet thresholds via HA UI sliders
- Automations: alerts when soil is too dry, too wet, or sensor goes offline
- Lovelace card config in comments at bottom of file

**Entity IDs to update once sensor is paired:**
- `sensor.rainpoint_soil_moisture` — actual moisture % from BLE sensor
- `sensor.rainpoint_soil_temperature` — soil temp in °C from BLE sensor

### `esphome-ble-proxy.yaml`
Flash this to a ~$5 ESP32 dev board to bridge the RainPoint's Bluetooth signal
to Home Assistant over WiFi — solves the Docker/Windows Bluetooth limitation.

**Steps:**
1. Fill in WiFi credentials in the file
2. Fill in secrets in `esphome_secrets.yaml`
3. `pip install esphome` then `esphome run esphome-ble-proxy.yaml` (USB connected)
4. Plug ESP32 into USB power near the garden (within 30ft of sensor)
5. HA auto-discovers it under Settings → Integrations → ESPHome
6. Then Settings → Integrations → Bluetooth shows the RainPoint device
