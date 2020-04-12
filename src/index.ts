import {PhotoFrame} from "./photoframe";

const frame = new PhotoFrame();

async function main(){
    // await frame.sendFile("/home/henry/screenshot.png");
    await frame.sendFile("/home/henry/Selection_201.png");  
}

frame.open().then(()=> {
    setInterval(main, 2000);
}).catch(() => {
    console.log("could not open device.")
});

