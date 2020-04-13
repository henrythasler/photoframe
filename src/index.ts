import { PhotoFrame } from "./photoframe";
import puppeteer from 'puppeteer';

const frame = new PhotoFrame();

const files = ["/home/henry/tegelberg.jpg", "/home/henry/screenshot.png", "/home/henry/schlegeis.jpg", "/home/henry/Selection_201.png"]
let i = 0;

async function renderPage(url:string) {
    const browser = await puppeteer.launch({
        defaultViewport: {
            width: 800,
            height: 600,
            isLandscape: true
        },
        executablePath: "chromium-browser"
    });

    let page = await browser.newPage();
    await page.goto(url);
    await page.screenshot({ path: './image.jpg', type: 'jpeg' });
    await page.close();
    await browser.close();    
}

async function main() {
    const filename = files[(i++)%files.length];
    console.log("\n"+filename)
    await frame.displayFile(filename);
    setTimeout(main, 2000);
    // await frame.sendFile("/home/henry/screenshot.png");
    // await frame.sendFile("/home/henry/Selection_201.png");
}

async function start() {
    frame.open().then((res) => {
        if (res === 0) {
            setTimeout(main, 2000);
        }
        else {
            console.log(`Could not open device. Error ${res}`);

        }
    }).catch((err) => {
        console.log(`Error opening device. ${err}`);
    });
}

// start();
try {
    renderPage('file:///home/henry/photoframe/html/clock.html?hour=13&minute=37&temp_in=24.1&temp_out=12.2');    
} catch (err) {
    console.log(err)
}
