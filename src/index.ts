import { readFileSync } from "fs";
import { parse } from "@iarna/toml";

import { PhotoFrame } from "./photoframe";
import { ImageGenerator, Config, Screen } from "./generator";
import { Log, LogLevels } from "./helper";

let renderIndex = 0;
let showIndex = 0;

interface SlideshowItem {
    image: Buffer | null,
    renderTimestamp: number,
    refreshSeconds: number,
    showSeconds: number,
    showRetries: number,
}

class Slideshow {
    protected log: Log;
    protected config: Config;
    protected slideshowItems: SlideshowItem[] = [];
    protected frame: PhotoFrame;
    protected generator: ImageGenerator;

    constructor(config: Config, logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
        this.config = config;
        this.frame = new PhotoFrame(logLevel);
        this.generator = new ImageGenerator(this.config, logLevel);

        config.screen.map((item) => {
            this.slideshowItems.push({
                image: null,
                renderTimestamp: 0,
                refreshSeconds: item.refreshSeconds ? item.refreshSeconds : 600,
                showSeconds: item.showSeconds ? item.showSeconds : 10,
                showRetries: 3
            })
        })
    }

    async render() {
        if (this.frame.screenAvailable()) {
            let item = this.slideshowItems[renderIndex];

            if ((item.renderTimestamp + item.refreshSeconds * 1000) < Date.now()) {
                item.image = await this.generator.renderScreen(renderIndex);
                item.renderTimestamp = Date.now();
            }
            else {
                // console.log(`idling...`)
            }
            renderIndex = (renderIndex + 1) % this.slideshowItems.length;
        }
        else {
            renderIndex = 0;
        }
        setTimeout(() => this.render(), 1000);
    }

    async show() {
        let timeout = 1000;
        if (this.frame.screenAvailable()) {
            let item = this.slideshowItems[showIndex];
            if (item && item.image) {
                await this.frame.displayImage(item.image);
                timeout = item.showSeconds * 1000;
                showIndex = (showIndex + 1) % this.slideshowItems.length;
            }
            else {
                item.showRetries = item.showRetries - 1;
                if (item.showRetries === 0) {
                    item.showRetries = 3;
                    showIndex = (showIndex + 1) % this.slideshowItems.length;
                }
            }

        }
        else {
            showIndex = 0;
            timeout = 5000;
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

const config = parse(readFileSync("config/test.toml", "utf8")) as unknown as Config;
const slideshow = new Slideshow(config, LogLevels.INFO);
slideshow.start();
