import sharp, {Blend} from "sharp";
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

export type ScreenContentType = "image" | "html";

export interface ScreenSource {
    name?: string
    type?: ScreenContentType
    refreshSeconds: number
    showSeconds: number
    url?: string
    location?: string
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

    constructor(settings: Settings, source: ScreenSource[], logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
        this.settings = settings;
        source.map( (item) => {
            this.screens.push({
                source: item,
                image: null,
                renderTimestamp: 0,
                showRetries: 3
            }) 
        } );
    }


    templateEngine(input: string): string {
        const date = new Date();

        // https://momentjs.com/docs/#/parsing/string-format/
        return input
            .replace(/{HH}/g, `${date.getHours().toString().padStart(2, '0')}`)
            .replace(/{H}/g, `${date.getHours().toString()}`)
            .replace(/{mm}/g, `${date.getMinutes().toString().padStart(2, '0')}`)
            .replace(/{m}/g, `${date.getMinutes().toString()}`)

            .replace(/{cwd}/g, `${process.cwd()}`)
    }

    async timeout(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }    

    async renderHtml(url: URL, domElement?: string, domTimeout?:number): Promise<sharp.Sharp | null> {
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

        let expandedUrl = this.templateEngine(url.href)

        this.log.show(`renderHtml(): ${expandedUrl}`, LogLevels.TRACE);
        await page.goto(expandedUrl);

        if(domTimeout) {
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
        this.log.show(`getImage(): ${uri.protocol} ${uri.pathname}`, LogLevels.TRACE);
        switch (uri.protocol) {
            case "file:":
                image = sharp(this.templateEngine(uri.pathname), { sequentialRead: true });
                break;

            case "http:":
            case "https:":
                const response = await fetch(this.templateEngine(uri.href));
                image = sharp(await response.buffer());
                break;

            default:
                this.log.show(`getImage(): no handler for protocol '${uri.protocol}'`, LogLevels.ERROR);
                break;
        }
        return image;
    }

    async getFileImage(uri: string): Promise<sharp.Sharp | null> {
        let image: sharp.Sharp | null = null;

        this.log.show(`getImage(): ${uri}`, LogLevels.TRACE);
        image = sharp(uri, { sequentialRead: true });

        return image;
    }

    async renderNext(): Promise<void> {
        try {
            const screen = this.screens[this.index];
            if ((screen.renderTimestamp + screen.source.refreshSeconds * 1000) < Date.now()) {
                screen.image = await this.renderScreen(this.index);
                screen.renderTimestamp = Date.now();
            }
            else {
                this.log.show(`renderNext(): no update needed for ${this.index} (${screen.source.url?screen.source.url:screen.source.type})`, LogLevels.TRACE);
            }
            this.index = (this.index + 1) % this.screens.length;
        } catch (error) {
            this.log.show(`renderNext(): ${error}`, LogLevels.ERROR);                        
        }
    }

    getLength():number {
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
                    image = await this.getUrlImage(new URL(screen.source.url));
                }
                else if (screen.source.location) {
                    image = await this.getFileImage(screen.source.location);
                }
                break;

            case "html":
                if (screen.source.url) {
                    image = await this.renderHtml(new URL(screen.source.url), screen.source.domElement, screen.source.domTimeout);
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