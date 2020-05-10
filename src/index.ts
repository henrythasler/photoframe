import { readFileSync } from "fs";
import { parse } from "@iarna/toml";

import { PhotoFrame } from "./photoframe";
import { ImageGenerator, Settings, ScreenSource } from "./generator";
import { Log, LogLevels } from "./helper";
import { DataProvider, DataSource } from "./data";

export interface RawConfig {
    settings?: {
        width?: number,
        height?: number,
        isLandscape?: boolean,
    }
    data?: DataSource[]
    screens?: ScreenSource[]
    backgrounds?: ScreenSource[]
}

export interface Config {
    settings: Settings
    data: DataSource[]
    screens: ScreenSource[]
    backgrounds: ScreenSource[]
}

class Slideshow {
    protected log: Log;
    protected frame: PhotoFrame;
    protected backgrounds: ImageGenerator;
    protected screens: ImageGenerator;
    protected showIndex = 0;
    protected data: DataProvider;

    constructor(config: Config, logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
        this.frame = new PhotoFrame(logLevel);

        this.data = new DataProvider(logLevel);
        this.data.init(config.data);

        this.screens = new ImageGenerator(config.settings, config.screens, this.data, logLevel)
        this.backgrounds = new ImageGenerator(config.settings, config.backgrounds, this.data, logLevel);

    }

    async render() {
        if (this.frame.screenAvailable()) {
            await this.screens.renderNext();
            await this.backgrounds.renderNext();
        }
        setTimeout(() => this.render(), 1000);
    }

    async show() {
        let timeout = 5000;
        if (this.frame.screenAvailable()) {
            const screen = this.screens.getItem(this.showIndex);
            if (screen && screen.image) {
                let image = screen.image;
                if (screen.source.background) {
                    this.log.show(`adding background ${screen.source.background}`, LogLevels.TRACE);
                    let background = this.backgrounds.getItemByName(screen.source.background);
                    if (background && background.image) {
                        this.log.show(`composing image`, LogLevels.TRACE);
                        image = image.composite([{ input: await background.image.toBuffer(), blend: screen.source.blend ? screen.source.blend : "lighten" }])
                    }
                }
                else {
                    this.log.show(`no background`, LogLevels.TRACE);
                }
                try {
                    const buffer = await image.jpeg({ quality: 90 }).toBuffer();
                    await this.frame.displayImage(buffer);
                } catch (error) {
                    this.log.show(`[ERROR] show(): ${error}`, LogLevels.ERROR);                                        
                }
                timeout = screen.source.showSeconds ? screen.source.showSeconds * 1000 : 1000;
                this.showIndex = (this.showIndex + 1) % this.screens.getLength();
            }
            else {
                screen.showRetries = screen.showRetries - 1;
                if (screen.showRetries === 0) {
                    screen.showRetries = 3;
                    this.showIndex = (this.showIndex + 1) % this.screens.getLength();
                }
                timeout = 1000;
            }

        }
        else {
            this.showIndex = 0;
        }
        console.log(`sleep ${timeout}ms`)
        setTimeout(() => this.show(), timeout);
    }

    start() {
        this.frame.checkDevices();
        this.frame.registerCallbacks();
        setTimeout(() => this.render(), 100);
        setTimeout(() => this.show(), 3000);
    }

}

const rawConfig = parse(readFileSync("config/test.toml", "utf8")) as unknown as RawConfig;

// do some basic input checking
const config: Config = {
    settings: rawConfig.settings ? {
        width: rawConfig.settings.width ? rawConfig.settings.width : 800,
        height: rawConfig.settings.height ? rawConfig.settings.height : 600,
        isLandscape: rawConfig.settings.isLandscape ? rawConfig.settings.isLandscape : true
    } : {
            width: 800,
            height: 600,
            isLandscape: true
        },
    backgrounds: rawConfig.backgrounds ? rawConfig.backgrounds : [],    // FIXME: each item needs to be sanitized as well
    screens: rawConfig.screens ? rawConfig.screens : [],    // FIXME: each item needs to be sanitized as well
    data: []
}

if(rawConfig.data) {
    rawConfig.data.forEach(element => {
        if(element.name && element.url && element.type)
        config.data.push({
            name: element.name,
            url: element.url,
            type: element.type
        })
    });
}

const slideshow = new Slideshow(config, LogLevels.TRACE);
slideshow.start();
