import { findByIds, Device, OutEndpoint, LibUSBException, on } from "usb";
import { LogLevels, Log } from "./helper";
import sharp from "sharp";

/** 
 * https://beyondlogic.org/usbnutshell/usb6.shtml
 * https://www.cs.unm.edu/~hjelmn/libusb_hotplug_api/structlibusb__control__setup.html#a39b148c231d675492ccd2383196926bf
 * */
const LIBUSB_ENDPOINT_IN = 0x01 << 7
const LIBUSB_ENDPOINT_OUT = 0x00 << 7

const LIBUSB_REQUEST_TYPE_STANDARD = 0x00 << 5
const LIBUSB_REQUEST_TYPE_CLASS = 0x01 << 5
const LIBUSB_REQUEST_TYPE_VENDOR = 0x02 << 5
const LIBUSB_REQUEST_TYPE_RESERVED = 0x03 << 5

const LIBUSB_RECIPIENT_DEVICE = 0x00
const LIBUSB_RECIPIENT_INTERFACE = 0x01
const LIBUSB_RECIPIENT_ENDPOINT = 0x02
const LIBUSB_RECIPIENT_OTHER = 0x03

export type AttachedDevice = "none" | "storage" | "custom";

export class PhotoFrame {
    protected deviceHandle: Device | undefined = undefined;
    protected log: Log;
    protected attachedDevice: AttachedDevice = "none";

    protected properties = {
        vendorId: 0x04e8,
        productIdStorage: 0x200c,
        productIdCustom: 0x200d,
        width: 800,
        height: 600
    }

    constructor(logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
    }

    async asyncControlTransfer(device: Device, bmRequestType: number, bRequest: number, wValue: number, wIndex: number, data: Buffer | number): Promise<LibUSBException> {
        return new Promise<LibUSBException>((resolve, reject) => {
            device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, data, (err, buf) => {
                if (err) {
                    this.log.show(`controlTransfer(): Error ${err.errno} ${err.message}`, LogLevels.TRACE);
                    reject(err);
                }
                else {
                    this.log.show(`controlTransfer(): done`, LogLevels.TRACE);
                }
                resolve();
            })
        });
    }

    async asyncTransferOut(data: Buffer, endpoint: OutEndpoint): Promise<LibUSBException> {
        return new Promise<LibUSBException>((resolve, reject) => {
            this.log.show(`asyncTransferOut(): starting transfer`, LogLevels.TRACE);
            endpoint.transfer(data, err => {
                if (err) {
                    this.log.show(`asyncTransferOut(): Error ${err.errno} ${err.message}`, LogLevels.TRACE);
                    reject(err);
                }
                this.log.show(`asyncTransferOut(): done`, LogLevels.TRACE);
                resolve();
            })
        });
    }

    async asyncGetStringDescriptor(index: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (this.deviceHandle) {
                this.deviceHandle.getStringDescriptor(index, (err, buf) => {
                    if (err) {
                        this.log.show(`getStringDescriptor(): ${err}`, LogLevels.TRACE);
                        reject(err);
                    }
                    else {
                        resolve(buf?.toString());
                    }
                });
            }
        });
    }

    async setCustomDevice(device: Device): Promise<LibUSBException> {
        return await this.asyncControlTransfer(device, LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_STANDARD | LIBUSB_RECIPIENT_DEVICE, 0x06, 0xfe, 0xfe, Buffer.alloc(254));
    }

    attach = (device: Device) => {
        this.log.show(`attached: ${device.deviceDescriptor.idVendor.toString(16)}:${device.deviceDescriptor.idProduct.toString(16)}`, LogLevels.INFO);
        this.checkDevices();
    }

    detach = (device: Device) => {
        this.log.show(`detached: ${device.deviceDescriptor.idVendor.toString(16)}:${device.deviceDescriptor.idProduct.toString(16)}`, LogLevels.INFO);
        this.checkDevices();
    }

    registerCallbacks(attachFunction?: Function, detachFunction?: Function) {
        on('attach', (device) => attachFunction ? attachFunction(device) : this.attach(device));
        on('detach', (device) => detachFunction ? detachFunction(device) : this.detach(device));
    }

    async checkDevices() {
        let device: Device;
        if (device = findByIds(this.properties.vendorId, this.properties.productIdCustom)) {
            this.log.show(`checkDevices(): customDevice available (${device.deviceDescriptor.idVendor.toString(16)}:${device.deviceDescriptor.idProduct.toString(16)})`, LogLevels.INFO);
            this.attachedDevice = "custom";
            this.deviceHandle = this.open(device);
        }
        else if (device = findByIds(this.properties.vendorId, this.properties.productIdStorage)) {
            this.log.show(`checkDevices(): storageDevice available (${device.deviceDescriptor.idVendor.toString(16)}:${device.deviceDescriptor.idProduct.toString(16)})`, LogLevels.INFO);
            this.attachedDevice = "storage";
            // await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                this.deviceHandle = this.open(device);
                if(this.deviceHandle) {
                    await this.setCustomDevice(this.deviceHandle);
                }
            } catch (err) {
                this.log.show(`checkDevices(): error setting to customDevice ${err.errno} ${err.message} `, LogLevels.ERROR);
                return err.errno;
            }            
        }
        else {
            this.log.show(`checkDevices(): No device found.`, LogLevels.INFO);
            this.attachedDevice = "none";
            this.deviceHandle = undefined;
        }
        return this.attachedDevice;
    }

    screenAvailable():boolean {
        return (this.attachedDevice === "custom" && this.deviceHandle !== undefined)
    }

    open(device: Device): Device|undefined {
        if(this.deviceHandle === undefined) {
            this.log.show(`open(): (${device.deviceDescriptor.idVendor.toString(16)}:${device.deviceDescriptor.idProduct.toString(16)})`, LogLevels.INFO);
            this.deviceHandle = device;
            this.deviceHandle.open(); 
        }
        return this.deviceHandle;
    }

    close() {
        if (this.deviceHandle !== undefined) {
            this.log.show(`close(): Closing device.`, LogLevels.INFO);
            this.deviceHandle.close();
        }
    }

    async sendData(data: Buffer, interfaceId: number, endpointId: number) {
        if (this.deviceHandle !== undefined) {
            const interfaceHandle = this.deviceHandle.interface(interfaceId);
            let endpointHandle = interfaceHandle.endpoint(endpointId);

            this.log.show(`sendData(): direction=${endpointHandle.direction} transferType=${endpointHandle.transferType} `, LogLevels.TRACE);
            if (endpointHandle instanceof OutEndpoint) {
                interfaceHandle.claim();
                this.log.show(`sendData(): Try sending data...`, LogLevels.TRACE);
                try {
                    await this.asyncTransferOut(data, endpointHandle);
                    this.log.show(`sendData(): done`, LogLevels.TRACE);
                    interfaceHandle.release(cb => { });
                    return true;
                } catch (error) {
                    interfaceHandle.release(cb => { });
                    return false;
                }
            }
            else {
                this.log.show(`sendData(): expected OutEndpoint but direction=${endpointHandle.direction} for endpoint ${endpointId}`, LogLevels.ERROR);
            }
        }
    }

    imagePreprocessing(image: sharp.Sharp) {
        return image.resize(
            this.properties.width,
            this.properties.height,
            {
                fit: sharp.fit.contain,
                kernel: sharp.kernel.cubic
            }
        );
    }

    async displayFile(filename: string) {
        const header = Buffer.from([0xa5, 0x5a, 0x18, 0x04, 0, 0, 0, 0, 0x48, 0x00, 0x00, 0x00])
        try {
            const originalImage = await sharp(filename, { sequentialRead: true });
            const image = await this.imagePreprocessing(originalImage).jpeg({ quality: 90 }).toBuffer();
            header.writeInt32LE(image.length, 4);
            let data = Buffer.concat([header, image]);
            const padding = 16384 - (data.length % 16384);
            data = Buffer.concat([data, Buffer.alloc(padding)]);
            this.log.show(`Sending ${data.length} bytes. Header = '${this.log.toHexString(header)}'. Image size = ${image.length} `, LogLevels.INFO);
            if (await this.sendData(data, 0, 2)) {
                return true;
            }
            return false;
        } catch (err) {
            this.log.show(`sendFile: ${err.message}`, LogLevels.ERROR);
        }
    }

    async displayImage(image: Buffer) {
        const header = Buffer.from([0xa5, 0x5a, 0x18, 0x04, 0, 0, 0, 0, 0x48, 0x00, 0x00, 0x00])
        try {
            header.writeInt32LE(image.length, 4);
            let data = Buffer.concat([header, image]);
            const padding = 16384 - (data.length % 16384);
            data = Buffer.concat([data, Buffer.alloc(padding)]);
            this.log.show(`displayImage(): Sending ${data.length} bytes. Header = '${this.log.toHexString(header)}'. Image size = ${image.length} `, LogLevels.TRACE);
            if (await this.sendData(data, 0, 2)) {
                return true;
            }
            return false;
        } catch (err) {
            this.log.show(`displayImage(): ${err.message}`, LogLevels.ERROR);
        }
    }

}
