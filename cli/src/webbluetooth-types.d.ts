// Type declarations for webbluetooth module
// The package doesn't export all types from index.d.ts, so we declare them here

declare module 'webbluetooth' {
  export class Bluetooth {
    constructor(options?: BluetoothOptions);
    getAvailability(): Promise<boolean>;
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
    getDevices(): Promise<BluetoothDevice[]>;
    cancelRequest(): void;
  }

  export interface BluetoothOptions {
    deviceFound?: (device: BluetoothDevice, selectFn: () => void) => boolean;
    scanTime?: number;
    allowAllDevices?: boolean;
    referringDevice?: BluetoothDevice;
    adapterIndex?: number;
  }

  export function getAdapters(): Array<{ index: number; address: string; active: boolean }>;

  export const bluetooth: Bluetooth;

  export class BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name: string;
    readonly gatt: BluetoothRemoteGATTServer;
    readonly watchingAdvertisements: boolean;
    forget(): Promise<void>;
  }

  export class BluetoothRemoteGATTServer {
    readonly device: BluetoothDevice;
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
  }

  export class BluetoothRemoteGATTService extends EventTarget {
    readonly device: BluetoothDevice;
    readonly uuid: string;
    readonly isPrimary: boolean;
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(characteristic?: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }

  export class BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly service: BluetoothRemoteGATTService;
    readonly uuid: string;
    readonly properties: BluetoothCharacteristicProperties;
    readonly value?: DataView;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithResponse(value: BufferSource): Promise<void>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  export class BluetoothUUID {
    static getService(name: string | number): string;
    static getCharacteristic(name: string | number): string;
    static getDescriptor(name: string | number): string;
    static canonicalUUID(alias: number): string;
  }
}
