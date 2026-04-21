// Type definitions for Web Bluetooth API
// These are needed because @types/web-bluetooth may not be installed

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>;
  onavailabilitychanged: ((this: Bluetooth, ev: Event) => any) | null;
  readonly referringDevice?: BluetoothDevice;
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  getDevices(): Promise<BluetoothDevice[]>;
  requestLEScan(options?: BluetoothLEScanOptions): Promise<BluetoothLEScan>;
}

interface RequestDeviceOptions {
  filters?: BluetoothLEScanFilter[];
  exclusionFilters?: BluetoothLEScanFilter[];
  optionalServices?: BluetoothServiceUUID[];
  optionalManufacturerData?: number[];
  acceptAllDevices?: boolean;
  keepRepeatedDevices?: boolean;
}

interface BluetoothLEScanFilter {
  name?: string;
  namePrefix?: string;
  services?: BluetoothServiceUUID[];
  manufacturerData?: BluetoothManufacturerDataFilter;
  serviceData?: BluetoothServiceDataFilter;
}

interface BluetoothManufacturerDataFilter {
  [key: number]: { dataPrefix?: BufferSource; mask?: BufferSource };
}

interface BluetoothServiceDataFilter {
  [key: string]: { dataPrefix?: BufferSource; mask?: BufferSource };
}

interface BluetoothLEScanOptions extends RequestDeviceOptions {
  keepRepeatedDevices?: boolean;
}

interface BluetoothLEScan extends EventTarget {
  readonly active: boolean;
  readonly filter: BluetoothLEScanFilter;
  stop(): void;
}

declare var BluetoothLEScan: {
  prototype: BluetoothLEScan;
};

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name: string | null;
  readonly gatt: BluetoothRemoteGATTServer | null;
  readonly uuids: string[];
  watchingAdvertisements: boolean;
  forget(): Promise<void>;
  watchAdvertisements(): Promise<void>;
  unwatchAdvertisements(): void;
  onadvertisementreceived: ((this: BluetoothDevice, ev: BluetoothAdvertisingEvent) => any) | null;
  ongattserverdisconnected: ((this: BluetoothDevice, ev: Event) => any) | null;
}

interface BluetoothAdvertisingEvent extends Event {
  readonly device: BluetoothDevice;
  readonly uuids: string[];
  readonly manufacturerData: BluetoothManufacturerData;
  readonly serviceData: BluetoothServiceData;
  readonly rssi: number;
  readonly txPower: number;
}

declare var BluetoothAdvertisingEvent: {
  prototype: BluetoothAdvertisingEvent;
  new (type: string, init: BluetoothAdvertisingEventInit): BluetoothAdvertisingEvent;
};

interface BluetoothAdvertisingEventInit extends EventInit {
  device: BluetoothDevice;
  uuids?: string[];
  manufacturerData?: BluetoothManufacturerData;
  serviceData?: BluetoothServiceData;
  rssi?: number;
  txPower?: number;
}

type BluetoothServiceUUID = string | number;
type BluetoothCharacteristicUUID = string | number;
type BluetoothDescriptorUUID = string | number;

interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice;
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTService {
  readonly device: BluetoothDevice;
  readonly uuid: string;
  readonly isPrimary: boolean;
  getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(characteristic?: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic[]>;
  getIncludedService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  getIncludedServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly service: BluetoothRemoteGATTService;
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value: DataView | null;
  getDescriptor(descriptor: BluetoothDescriptorUUID): Promise<BluetoothRemoteGATTDescriptor>;
  getDescriptors(descriptor?: BluetoothDescriptorUUID): Promise<BluetoothRemoteGATTDescriptor[]>;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  oncharacteristicvaluechanged: ((this: BluetoothRemoteGATTCharacteristic, ev: Event) => any) | null;
}

interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly authenticatedSignedWrites: boolean;
  readonly reliableWrite: boolean;
  readonly writableAuxiliaries: boolean;
}

interface BluetoothRemoteGATTDescriptor {
  readonly characteristic: BluetoothRemoteGATTCharacteristic;
  readonly uuid: string;
  readonly value: DataView | null;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothManufacturerData extends Map<number, DataView> {}
interface BluetoothServiceData extends Map<string, DataView> {}

interface Navigator {
  bluetooth: Bluetooth;
}

interface Window {
  BluetoothDevice: typeof BluetoothDevice;
  BluetoothRemoteGATTServer: typeof BluetoothRemoteGATTServer;
  BluetoothRemoteGATTService: typeof BluetoothRemoteGATTService;
  BluetoothRemoteGATTCharacteristic: typeof BluetoothRemoteGATTCharacteristic;
}
