import sharp from "sharp";
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

export interface Screen {
    type?: ScreenContentType
    refreshSeconds?: number
    showSeconds?: number
    url?: string
    location?: string
}

export interface Config {
    width?: number,
    height?: number,
    isLandscape?: boolean,
    screen: Screen[]
}

export class ImageGenerator {
    protected log: Log;
    protected config: Config;

    constructor(config: Config, logLevel: number = LogLevels.TRACE) {
        this.log = new Log(logLevel);
        this.config = config;
        // parse(readFileSync(configFile, "utf8")) as unknown as Config;
        // this.log.show(`configFile: ${JSON.stringify(this.config)}`, LogLevels.TRACE);
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

    async renderHtml(url: URL): Promise<sharp.Sharp | null> {
        let image: sharp.Sharp | null = null;
        const browser = await puppeteer.launch({
            defaultViewport: {
                width: this.config.width,
                height: this.config.height,
                isLandscape: this.config.isLandscape
            },
            executablePath: "chromium-browser",
            args: process.getuid() == 0 ? ['--no-sandbox'] : undefined  // https://techoverflow.net/2019/11/08/how-to-fix-puppetteer-running-as-root-without-no-sandbox-is-not-supported/
        });

        let page = await browser.newPage();

        let expandedUrl = this.templateEngine(url.href)

        this.log.show(`renderHtml(): ${expandedUrl}`, LogLevels.TRACE);
        await page.goto(expandedUrl);
        image = sharp(await page.screenshot());
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


    async renderScreen(index: number): Promise<Buffer | null> {
        const screen = this.config.screen[index % this.config.screen.length];
        let composedImage: Buffer | null = null;

        let image: sharp.Sharp | null = null;

        switch (screen.type) {
            case "image":
                if (screen.url) {
                    image = await this.getUrlImage(new URL(screen.url));
                }
                else if (screen.location) {
                    image = await this.getFileImage(screen.location);
                }
                break;

            case "html":
                if (screen.url) {
                    image = await this.renderHtml(new URL(screen.url));
                }
                else {
                    this.log.show(`renderScreen(): 'screen.url' is needed for html-type.`, LogLevels.ERROR);
                }

            default:
                break;
        }

        if (image) {
            composedImage = await image.resize(
                this.config.width,
                this.config.height,
                {
                    fit: sharp.fit.contain,
                    kernel: sharp.kernel.cubic
                }
            ).jpeg({ quality: 90 }).toBuffer();
        }
        return composedImage;

    }

}