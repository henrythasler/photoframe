import sharp, { Blend } from "sharp";
import puppeteer from "puppeteer";
import fetch, {
    Blob,
    Headers,
    Request,
    RequestInit,
    Response,
    FetchError
} from "node-fetch";

import { LogLevels, Log } from "./helper";
import { DataProvider } from "./data";

export type ScreenContentType = "image" | "html";


export interface ScreenSource {
    name?: string
    type?: ScreenContentType
    refreshSeconds: number
    showSeconds: number
    url?: string
    domElement?: string
    domTimeout?: number
    background?: string
    blend?: Blend
}

export interface Screen {
    source: ScreenSource,
    image: sharp.Sharp | null,
    renderTimestamp: number,
    showRetries: number,
}

export interface Settings {
    width: number,
    height: number,
    isLandscape: boolean,
}

export class ImageGenerator {
    protected log: Log;
    protected settings: Settings;
    protected screens: Screen[] = [];
    protected index = 0;
    protected data: DataProvider;

    constructor(settings: Settings, source: ScreenSource[], data: DataProvider, logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
        this.settings = settings;
        source.map((item) => {
            this.screens.push({
                source: item,
                image: null,
                renderTimestamp: 0,
                showRetries: 3
            })
        });
        this.data = data;

    }

    async init():Promise<void>{
        for(let i=0; i< this.screens.length; i++) {
            const screen = this.screens[i]
            if(screen.source.url) {
                const url = new URL(screen.source.url);
                if(url.protocol === "mqtt:") {
                    this.data.add([{
                        name: url.pathname.substr(1),
                        type: "mqtt",
                        url: url.href
                    }])
                }
            }
        }
    }

    templateEngine(input: string): string {
        const date = new Date();

        // https://momentjs.com/docs/#/parsing/string-format/
        let res = input
            // Hour
            .replace(/{HH}/g, `${date.getHours().toString().padStart(2, '0')}`)
            .replace(/{H}/g, `${date.getHours().toString()}`)
            // Minute
            .replace(/{mm}/g, `${date.getMinutes().toString().padStart(2, '0')}`)
            .replace(/{m}/g, `${date.getMinutes().toString()}`)

            // Last 
            .replace(/{LAST_FULL_TEN_MINUTES}/g, `${(Math.floor(date.getMinutes() / 10) * 10).toString().padStart(2, '0')}`)

            // Year
            .replace(/{YYYY}/g, `${date.getFullYear().toString().padStart(2, '0')}`)

            // Month
            .replace(/{MM}/g, `${(date.getMonth() + 1).toString().padStart(2, '0')}`)
            .replace(/{M}/g, `${(date.getMonth() + 1).toString()}`)
            // Day
            .replace(/{DD}/g, `${date.getDate().toString().padStart(2, '0')}`)
            .replace(/{D}/g, `${date.getDate().toString()}`)

            // Current folder
            .replace(/{cwd}/g, `${process.cwd()}`);


        let dataExpressions = res.match(/{data:.+?}/g);

        if (dataExpressions) {
            dataExpressions.forEach(expression => {
                this.log.show(`templateEngine(): expression=${expression}`, LogLevels.TRACE);
                const name = expression.match(/:([^)]+)\./);
                const property = expression.match(/\.([^)]+)}/);

                if (name && property) {
                    this.log.show(`templateEngine(): name=${name[1]} property=${property[1]}`, LogLevels.TRACE);
                    res = res.replace(expression, this.data.get(name[1], property[1]).toString());
                }
                else if (name) {
                    this.log.show(`templateEngine(): name=${name[1]}`, LogLevels.TRACE);
                    res = res.replace(expression, this.data.get(name[1]).toString());
                }
            });
        }

        return res;
    }

    async timeout(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async renderHtml(url: URL, domElement?: string, domTimeout?: number): Promise<sharp.Sharp | null> {
        let image: sharp.Sharp | null = null;
        const browser = await puppeteer.launch({
            defaultViewport: {
                width: this.settings.width,
                height: this.settings.height,
                isLandscape: this.settings.isLandscape
            },
            executablePath: "chromium-browser",
            args: process.getuid() == 0 ? ['--no-sandbox'] : undefined  // https://techoverflow.net/2019/11/08/how-to-fix-puppetteer-running-as-root-without-no-sandbox-is-not-supported/
        });

        let page = await browser.newPage();

        this.log.show(`renderHtml(): ${url.href}`, LogLevels.TRACE);
        await page.goto(url.href);

        if (domTimeout) {
            await this.timeout(domTimeout);
        }

        if (domElement) {
            await page.waitForSelector(domElement);          // wait for the selector to load
            const element = await page.$(domElement);        // declare a variable with an ElementHandle
            if (element) {
                image = sharp(await element.screenshot()); // take screenshot element in puppeteer
            }
            else {
                image = sharp(await page.screenshot());
            }
        }
        else {
            image = sharp(await page.screenshot());
        }

        await page.close();
        await browser.close();
        return image;
    }

    async getUrlImage(uri: URL): Promise<sharp.Sharp | null> {
        let image: sharp.Sharp | null = null;
        this.log.show(`getUrlImage(): ${uri.protocol} ${uri.pathname}`, LogLevels.TRACE);
        switch (uri.protocol) {
            case "file:":
                image = sharp(uri.pathname, { sequentialRead: true });
                break;

            case "http:":
            case "https:":
                try {
                    const response = await fetch(uri.href);
                    image = sharp(await response.buffer());
                } catch (error) {
                    this.log.show(`getUrlImage(): '${error}'`, LogLevels.ERROR);
                    image = null;
                }
                break;
            case "mqtt:":
                const name = uri.pathname.substr(1);
                const buf = this.data.get(name);
                this.log.show(`getUrlImage(): ${uri.protocol} ${uri.pathname} length=${buf.length}`, LogLevels.TRACE);
                try {
                    image = sharp(buf);
                    let temp = await image.jpeg({ quality: 90 }).toBuffer();
                } catch (error) {
                    this.log.show(`getUrlImage(): '${error}'`, LogLevels.ERROR);
                    image = null;
                }
                break;

            default:
                this.log.show(`getUrlImage(): no handler for protocol '${uri.protocol}'`, LogLevels.ERROR);
                break;
        }
        return image;
    }

    async renderNext(): Promise<void> {
        if(this.screens.length) {
            try {
                const screen = this.screens[this.index];
                if ((screen.renderTimestamp + screen.source.refreshSeconds * 1000) < Date.now()) {
                    screen.image = await this.renderScreen(this.index);
                    screen.renderTimestamp = Date.now();
                }
                else {
                    this.log.show(`renderNext(): no update needed for ${this.index} (${screen.source.url ? screen.source.url : screen.source.type})`, LogLevels.TRACE);
                }
                this.index = (this.index + 1) % this.screens.length;
            } catch (error) {
                this.log.show(`renderNext(): ${error}`, LogLevels.ERROR);
            }
        }
        else {
            this.log.show(`renderNext(): no screens defined`, LogLevels.INFO);
        }
    }

    getLength(): number {
        return this.screens.length;
    }

    getItem(index: number): Screen {
        return this.screens[index];
    }

    getItemByName(name: string): Screen | undefined {
        return this.screens.find((bg) => { return bg.source.name === name });
    }

    async renderScreen(index: number): Promise<sharp.Sharp | null> {
        const screen = this.screens[index % this.screens.length];
        let composedImage: sharp.Sharp | null = null;

        let image: sharp.Sharp | null = null;

        switch (screen.source.type) {
            case "image":
                if (screen.source.url) {
                    image = await this.getUrlImage(new URL(this.templateEngine(screen.source.url)));
                }
                break;

            case "html":
                if (screen.source.url) {
                    image = await this.renderHtml(new URL(this.templateEngine(screen.source.url)), screen.source.domElement, screen.source.domTimeout);
                }
                else {
                    this.log.show(`renderScreen(): 'screen.url' is needed for html-type.`, LogLevels.ERROR);
                }
                break;

            default:
                break;
        }

        if (image) {
            composedImage = image.resize(
                this.settings.width,
                this.settings.height,
                {
                    fit: sharp.fit.contain,
                    kernel: sharp.kernel.cubic
                }
            );
        }
        return composedImage;

    }

}