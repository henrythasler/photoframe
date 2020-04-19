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