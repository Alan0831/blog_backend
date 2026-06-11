const path = require('path');
const fs = require('fs');
const folderPath = path.resolve(path.join(__dirname, `./static/video/`));
        const files = fs.readdirSync(folderPath);
        console.log(files);