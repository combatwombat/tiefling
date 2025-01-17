import Alpine from '/js/alpine.esm.js';
window.Alpine = Alpine;

import { Tiefling } from '/js/tiefling/tiefling.js';

let tiefling = new Tiefling(document.querySelector(".tiefling"));

URLSearchParams.prototype.getRaw = function(param) {
    const regex = new RegExp(`[?&]${param}=([^&]+)`, 'i');
    const match = window.location.search.match(regex);
    return match ? match[1] : null;
};


Alpine.data('app', () => ({

    state: 'idle',
    menuVisible: false,
    displayMode: 'full',
    possibleDisplayModes: tiefling.getPossibleDisplayModes(), // full, hsbs, fsbs, anaglyph (red cyan)

    tieflingDragActive: false, // dragging image onto canvas?

    inputImageURL: '',
    inputImageFile: null,
    inputImageDragActive: false,
    inputImage: null,
    inputDataURL: '',

    depthmapImageURL: '', // loaded depthmap via url?
    depthmapImageFile: null, // or via file
    depthmapImageDragActive: false,
    depthmapImage: null,
    depthmapURL: '', // URL of depthmap (generated or loaded externally)
    depthmapDataURL: '', // URL to loaded image
    depthmapSize: tiefling.getDepthmapSize(),

    focus: tiefling.getFocus(),
    devicePixelRatio: tiefling.getDevicePixelRatio(),
    mouseXOffset: 0.3, // for hsbs, fsbs and anaglyph modes. 0 0 no 3d, 0.3 is a good default

    fullscreen: false, // fullscreen selected?

    bookmarkletCode: '',

    exampleImages: ['jungle', 'portrait', 'robot', 'hoernchen', 'wombat-on-a-lawnmower', 'hotdog', 'bernd', 'cafetattoos', 'beachpeace', 'boardbear', 'crystalmountain', 'desertrace', 'spikypizza', 'bestpizza', 'mrfrog', 'seagulls', 'snack', 'rat'].map(image => ({
        'key': image,
        'image': 'img/examples/' + image + '.jpg',
        'thumb': 'img/examples/' + image + '_thumb.jpg',
        'depthmap': 'img/examples/' + image + '_depthmap.png'
    })),


    async init() {

        this.loadSettings();
        this.handleURLParams();
        this.generateBookmarkletLink();

        await this.initialLoadImage();

        this.updateDepthmapSize();
        this.updateFocus();
        this.updateDevicePixelRatio();


        // click anywhere outside .menu or.toggle-menu: set menuVisible to false
        document.addEventListener('click', (event) => {
            if (this.menuVisible && !event.target.closest('.menu') && !event.target.closest('.toggle-menu')) {
                this.menuVisible = false;
            }
        });

    },

    // load various settings from local storage
    loadSettings() {
        this.depthmapSize = parseInt(localStorage.getItem('depthmapSize')) || this.depthmapSize;
        this.focus = parseFloat(localStorage.getItem('focus')) || this.focus;
        this.devicePixelRatio = parseFloat(localStorage.getItem('devicePixelRatio')) || this.devicePixelRatio;
        this.displayMode = localStorage.getItem('displayMode') || this.displayMode;
        this.mouseXOffset = parseFloat(localStorage.getItem('mouseXOffset')) || this.mouseXOffset;
    },


    async generateBookmarkletLink() {
        try {
            const response = await fetch('/js/bookmarklet.js');
            this.bookmarkletCode = this.createBookmarklet(await response.text());
        } catch (error) {
            console.error('Error generating bookmarklet:', error);
        }
    },

    // create bookmarklet for current domain
    createBookmarklet(sourceCode) {
        // replace ---URL_PREFIX--- with current protocol, domain, port and path
        const urlPrefix = window.location.origin;

        let code = sourceCode
            .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // Remove comments
            .replace(/\s+/g, ' ')                    // Collapse whitespace
            .replace('---URL_PREFIX---', urlPrefix)
            .trim();

        return 'javascript:' + encodeURIComponent(code);
    },


    // handle optional URL parameters
    // ?input={url} - load image from URL, generate depthmap if none given
    // ?depthmap={url} - load depthmap from URL
    // ?displayMode={full, hsbs, fsbs, anaglyph} - set display mode
    handleURLParams() {
        // ?input parameter? load image from URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('input')) {
            this.inputImageURL = urlParams.getRaw('input');
        }

        if (urlParams.get('depthmap')) {
            this.depthmapURL = urlParams.getRaw('depthmap');
        }

        // set display mode from url param
        if (urlParams.get("displayMode")) {
            this.displayMode = this.possibleDisplayModes.contains(urlParams.get("displayMode")) ? urlParams.get("displayMode") : 'full';
        }
    },


    async initialLoadImage() {

        tiefling.setDisplayMode(this.displayMode);

        if (this.inputImageURL) {

            if (this.depthmapURL) {
                this.inputDataURL = this.inputImageURL;
                this.depthmapDataURL = this.depthmapImageURL = this.depthmapURL;
                tiefling.load3DImage(this.inputImageURL, this.depthmapURL);
            } else {
                this.state = "loading";

                // load image file from url
                let imageBlob;
                try {
                    imageBlob = await fetch(this.inputImageURL).then(response => response.blob());
                } catch (error) {
                    console.error("Error while loading image from URL:", error);
                    this.state = "error";
                    return;
                }

                // generate depth map
                this.depthmapURL = await tiefling.getDepthmapURL(imageBlob, this.depthmapSize);

                this.inputDataURL = URL.createObjectURL(imageBlob);
                this.depthmapDataURL = this.depthmapURL;

                tiefling.load3DImage(URL.createObjectURL(imageBlob), this.depthmapURL);
                this.state = "idle";
            }

        } else {

            // select a random example image
            const exampleImage = this.exampleImages[Math.floor(Math.random() * this.exampleImages.length)];

            this.depthmapImageURL = this.depthmapURL = this.depthmapDataURL = exampleImage.depthmap;
            this.inputImageURL = exampleImage.image;
            this.inputDataURL = this.inputImageURL;
            tiefling.load3DImage(this.inputImageURL, this.depthmapImageURL);
        }


    },



    // Handle file drop on whole canvas
    async tieflingImageFileDrop(event) {

        const file = event.dataTransfer.files[0];
        if (!file || !file.type.match('^image/')) {
            console.error("Dropped file is not an image");
            this.tieflingDragActive = false;
            return;
        }

        try {
            this.state = "loading";
            this.tieflingDragActive = false;

            this.inputDataURL = URL.createObjectURL(file);
            this.inputImageURL = '';
            this.depthmapImageURL = '';
            this.depthmapDataURL = '';
            this.depthmapURL = await tiefling.getDepthmapURL(file);
            this.depthmapDataURL = this.depthmapURL;

            await tiefling.load3DImage(URL.createObjectURL(file), this.depthmapURL);
            this.state = "idle";

        } catch (error) {
            console.error("Error while handling dropped file:", error);
            this.state = "error";
        }
    },


    // on input image file upload
    async handleInputImageFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.inputImageURL = "";
        this.inputImageFile = file;

        this.inputDataURL = URL.createObjectURL(file);

        // clear depthmap
        this.depthmapImage = this.depthmapImageFile = this.depthmapImageURL = this.depthmapURL = this.depthmapDataURL = null;

    },

    // Handle file drop on input field
    async handleInputImageFileDrop(event) {

        const file = event.dataTransfer.files[0];
        if (!file || !file.type.match('^image/')) {
            console.error("Dropped file is not an image");
            this.inputImageDragActive = false;
            return;
        }

        try {
            // Reset drag state and update status
            this.inputImageDragActive = false;
            this.inputImageURL = "";

            this.inputImageFile = file;
            this.inputDataURL = URL.createObjectURL(file);

            // clear depthmap
            this.depthmapImage = this.depthmapImageFile = this.depthmapImageURL = this.depthmapURL = this.depthmapDataURL = null;

        } catch (error) {
            console.error("Error while handling dropped file:", error);
            this.state = "error";
        }
    },

    // on depthmap file upload
    async handleDepthmapImageFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.depthmapImageURL = "";
        this.depthmapImageFile = file;

        this.depthmapDataURL = URL.createObjectURL(file);
    },


    // Handle file drop on depthmap field
    async handleDepthmapImageFileDrop(event) {

        const file = event.dataTransfer.files[0];
        if (!file || !file.type.match('^image/')) {
            console.error("Dropped file is not an image");
            this.depthmapImageDragActive = false;
            return;
        }

        try {
            // Reset drag state and update status
            this.depthmapImageDragActive = false;
            this.depthmapImageURL = "";
            this.depthmapImageFile = file;
            this.depthmapDataURL = URL.createObjectURL(file);

        } catch (error) {
            console.error("Error while handling dropped file:", error);
            this.state = "error";
        }
    },

    removeDepthmap() {
        this.depthmapImage = this.depthmapImageFile = this.depthmapImageURL = this.depthmapURL = this.depthmapDataURL = null;
    },

    removeInputImage() {
        this.inputImage = this.inputImageFile = this.inputImageURL = this.inputDataURL = null;
    },

    async loadImage() {
        this.state = "loading";
        try {
            this.inputImage = this.depthmapImage = null;

            let inputURL = '';
            this.depthmapURL = '';

            // get input image from url or uploaded aor dragged file
            if (this.inputImageFile) {
                this.inputImage = this.inputImageFile;
            } else if (this.inputImageURL) {
                inputURL = this.inputImageURL;
                this.inputImage = await fetch(this.inputImageURL).then(response => response.blob());
            }

            // get depthmap image from url, uploaded or dragged file
            if (this.depthmapImageFile) {
                this.depthmapImage = this.depthmapImageFile;
                this.depthmapURL = URL.createObjectURL(this.depthmapImage);

            } else if (this.depthmapImageURL) {
                this.depthmapURL = this.depthmapImageURL;
                this.depthmapImage = await fetch(this.depthmapImageURL).then(response => response.blob());
            }

            if (this.depthmapImage) {
                tiefling.load3DImage(URL.createObjectURL(this.inputImage), URL.createObjectURL(this.depthmapImage));

            } else {
                this.depthmapURL = await tiefling.getDepthmapURL(this.inputImage);

                this.depthmapImage = await fetch(this.depthmapURL).then(response => response.blob());
                tiefling.load3DImage(URL.createObjectURL(this.inputImage), this.depthmapURL);

            }

            this.depthmapDataURL = URL.createObjectURL(this.depthmapImage);
            this.inputDataURL = URL.createObjectURL(this.inputImage);

            // add ?input (and optional &depthmap) parameter to history, if the urls start with https
            if (inputURL.match(/^https?:\/\//)) {

                let newPath = window.location.origin + window.location.pathname + '?input=' + encodeURIComponent(inputURL);

                if (this.depthmapURL.match(/^https?:\/\//)) {
                    newPath += '&depthmap=' + encodeURIComponent(this.depthmapURL);
                }

                history.pushState({}, '', newPath);
            }

            this.state = "idle";
        } catch (error) {
            console.error("Error while loading image:", error);
            this.state = "error";
        }


    },

    updateFocus() {
        tiefling.setFocus(this.focus);
        localStorage.setItem('focus', this.focus);
    },

    updateDepthmapSize() {
        tiefling.setDepthmapSize(parseInt(this.depthmapSize));
        localStorage.setItem('depthmapSize', this.depthmapSize);
    },

    updateDevicePixelRatio() {
        tiefling.setDevicePixelRatio(parseFloat(this.devicePixelRatio));
        localStorage.setItem('devicePixelRatio', this.devicePixelRatio);
    },

    updateDisplayMode() {
        localStorage.setItem('displayMode', this.displayMode);

        // re-init 3d view
        tiefling.setDisplayMode(this.displayMode);
        tiefling.load3DImage(this.inputDataURL, this.depthmapDataURL);
    },

    updateMouseXOffset() {
        localStorage.setItem('mouseXOffset', this.mouseXOffset);
        tiefling.setMouseXOffset(this.mouseXOffset);
    },


    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.body.requestFullscreen();
        }

        // if user presses esc or something and exits fullscreen:
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                this.fullscreen = false;
            }
        });

    }


}));

Alpine.start()


