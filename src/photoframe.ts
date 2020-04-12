import { findByIds, Device, OutEndpoint, LibUSBException } from 'usb';
import sharp from 'sharp';
import Jimp from 'jimp';


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

    protected storageDevice = {
        vid: 0x04e8,
        pid: 0x200c
    }

    protected customDevice = {
        vid: 0x04e8,
        pid: 0x200d
    }

    constructor(logLevel: number = LogLevels.ERROR) {
        // this.log = new Log(logLevel);
        this.log = new Log(LogLevels.TRACE);
    }

    async asyncControlTransfer(device: Device, bmRequestType: number, bRequest: number, wValue: number, wIndex: number, data: Buffer): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, data, err => {
                if (err) {
                    reject(new Error('failed'));
                }
                resolve();
            })
        });
    }

    async asyncTransferOut(data: Buffer, endpoint: OutEndpoint): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.log.show(`starting endpoint.transfer.`, LogLevels.TRACE);
            endpoint.transfer(data, err => {
                if (err) {
                    reject(new Error('failed'));
                }
                this.log.show(`done endpoint.transfer.`, LogLevels.TRACE);
                resolve();
            })
        });
    }

    async setCustomDevice(device: Device): Promise<string> {
        return await this.asyncControlTransfer(device, LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_STANDARD | LIBUSB_RECIPIENT_DEVICE, 0x06, 0xfe, 0xfe, Buffer.alloc(254));
    }

    async open(): Promise<any> {
        if (this.device === undefined) {
            if (this.device = findByIds(this.customDevice.vid, this.customDevice.pid)) {
                this.device.open();
                this.log.show(`found customDevice`, LogLevels.DEBUG);
            }
            else if (this.device = findByIds(this.storageDevice.vid, this.storageDevice.pid)) {
                this.device.open();
                this.log.show(`found storageDevice, setting to customDevice...`, LogLevels.DEBUG);
                let res = await this.setCustomDevice(this.device);
                if (res) {
                    this.log.show(`done`, LogLevels.DEBUG);
                }
                else {
                    this.log.show(`error switching to customDevice`, LogLevels.ERROR);
                }
            }
            else {
                this.log.show(`No device found.`, LogLevels.ERROR);
                return Promise.reject();
            }
        }
        else {
            this.log.show(`Device already open.`, LogLevels.INFO);
        }
        return Promise.resolve();
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

            this.log.show(`direction=${endpointHandle.direction} transferType=${endpointHandle.transferType}`, LogLevels.DEBUG);
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

    async sendFile(filename: string) {
        let header = Buffer.from([0xa5, 0x5a, 0x18, 0x04, 0, 0, 0, 0, 0x48, 0x00, 0x00, 0x00])
        let image = await sharp(filename, { sequentialRead: true })
            .modulate({
                hue: Math.floor(Math.random() * 360)
            })
            .blur(Math.random() * 10 + 0.3)
            .jpeg({ quality: 90 })
            .toBuffer();
        header.writeInt32LE(image.length, 4);
        let data = Buffer.concat([header, image]);
        let padding = 16384 - (data.length % 16384);
        data = Buffer.concat([data, Buffer.alloc(padding)]);
        console.log(`sending ${data.length} bytes. header=${this.log.toHexString(header)}. image size=${image.length}`);
        try {
            await this.sendData(data, 0, 2);
        } catch (error) {
            this.log.show(`${error}`, LogLevels.ERROR);
        }
    }
}
