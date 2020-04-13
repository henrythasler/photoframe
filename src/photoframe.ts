import { findByIds, Device, OutEndpoint, LibUSBException } from 'usb';
import sharp from 'sharp';

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

export enum LogLevels { SILENT = 1, ERROR, INFO, DEBUG, TRACE }

/**
 * Wrapper for Debug-Outputs to console
 * @param msg object to log
 * @param level log-level
 */
export class Log {
    loglevel: LogLevels;

    constructor(level?: LogLevels) {
        this.loglevel = (level) ? level : LogLevels.DEBUG;
    }

    show(msg: any, level: number) {
        if (level <= this.loglevel) console.log(msg);
    }

    toHexString(byteArray: Buffer) {
        return Array.from(byteArray, function (byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        }).join(' ')
    }
}

export class PhotoFrame {
    protected device: Device | undefined = undefined;
    protected log: Log;

    protected properties = {
        vendorId: 0x04e8,
        productIdStorage: 0x200c,
        productIdCustom: 0x200d,
        width: 800,
        height: 600
    }

    constructor(logLevel: number = LogLevels.TRACE) {
        this.log = new Log(logLevel);
    }

    async asyncControlTransfer(device: Device, bmRequestType: number, bRequest: number, wValue: number, wIndex: number, data: Buffer): Promise<LibUSBException> {
        return new Promise<LibUSBException>((resolve, reject) => {
            device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, data, err => {
                if (err) {
                    this.log.show(`error in device.controlTransfer(): ${err.errno} ${err.message}`, LogLevels.TRACE);
                    reject(err);
                }
                this.log.show(`done device.controlTransfer().`, LogLevels.TRACE);
                resolve();
            })
        });
    }

    async asyncTransferOut(data: Buffer, endpoint: OutEndpoint): Promise<LibUSBException> {
        return new Promise<LibUSBException>((resolve, reject) => {
            this.log.show(`starting endpoint.transfer.`, LogLevels.TRACE);
            endpoint.transfer(data, err => {
                if (err) {
                    this.log.show(`error in endpoint.transfer(): ${err.errno} ${err.message}`, LogLevels.TRACE);
                    reject(err);
                }
                this.log.show(`done endpoint.transfer.`, LogLevels.TRACE);
                resolve();
            })
        });
    }

    async asyncGetStringDescriptor(index: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (this.device) {
                this.device.getStringDescriptor(index, (err, buf) => {
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

    async open() {
        if (this.device === undefined) {
            if (this.device = findByIds(this.properties.vendorId, this.properties.productIdCustom)) {
                this.log.show(`customDevice ${this.device.deviceDescriptor.idVendor.toString(16)}:${this.device.deviceDescriptor.idProduct.toString(16)}`, LogLevels.DEBUG);
                try {
                    this.device.open();
                    const iProduct = await this.asyncGetStringDescriptor(this.device.deviceDescriptor.iProduct);
                    this.log.show(`found ${iProduct}`, LogLevels.INFO);

                } catch (err) {
                    this.log.show(`error opening device ${err.errno} ${err.message} `, LogLevels.ERROR);
                    return err.errno;
                }
            }
            else if (this.device = findByIds(this.properties.vendorId, this.properties.productIdStorage)) {
                this.log.show(`found storageDevice, setting to customDevice...`, LogLevels.DEBUG);
                try {
                    this.device.open();
                    await this.setCustomDevice(this.device);
                } catch (err) {
                    this.log.show(`error setting to customDevice ${err.errno} ${err.message} `, LogLevels.ERROR);
                    return err.errno;
                }
                this.log.show(`done`, LogLevels.DEBUG);
            }
            else {
                this.log.show(`No device found.`, LogLevels.ERROR);
                return -100;
            }
        }
        else {
            this.log.show(`Device already open.`, LogLevels.INFO);
        }
        return 0;
    }

    close() {
        if (this.device !== undefined) {
            this.log.show(`Closing device.`, LogLevels.INFO);
            this.device.close();
        }
    }

    async sendData(data: Buffer, interfaceId: number, endpointId: number) {
        if (this.device !== undefined) {
            const interfaceHandle = this.device.interface(interfaceId);
            let endpointHandle = interfaceHandle.endpoint(endpointId);

            this.log.show(`direction=${endpointHandle.direction} transferType=${endpointHandle.transferType} `, LogLevels.TRACE);
            if (endpointHandle instanceof OutEndpoint) {
                interfaceHandle.claim();
                this.log.show(`Try sending data...`, LogLevels.TRACE);
                try {
                    await this.asyncTransferOut(data, endpointHandle);
                    this.log.show(`Done sending data...`, LogLevels.TRACE);
                    interfaceHandle.release(cb => { });
                    return true;
                } catch (error) {
                    interfaceHandle.release(cb => { });
                    return false;
                }
            }
            else {
                this.log.show(`expected OutEndpoint but direction=${endpointHandle.direction} for endpoint ${endpointId}`, LogLevels.ERROR);
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
}
