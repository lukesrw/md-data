const { exec } = require("child_process");
const { stat } = require("fs/promises");
const { join } = require("path");

/**
 * @param {string} title heading
 * @returns {void}
 */
function output(title) {
    console.log(`Starting ${title} Watcher`);

    return (error, stdout, stderr) => {
        error = error || stderr;

        if (error.length) {
            console.log(`${title}:`);
            console.error(error);
        } else if (stdout.length) {
            console.log(`${title}:`);
            console.log(stdout);
        }
    };
}

module.exports = async () => {
    let exists = {
        public: true,
        scss: true,
        ts: true,
        vue: true
    };

    for (let directory in exists) {
        if (Object.prototype.hasOwnProperty.call(exists, directory)) {
            try {
                await stat(join(__dirname, "..", directory));
            } catch (_1) {
                exists[directory] = false;
            }
        }
    }

    if (exists.ts) {
        exec("npm run ts-watch", output("TypeScript (./ts)"));
    }

    if (exists.vue) {
        exec("npm run vue", output("Vue (./vue)"));
    }

    if (exists.scss) {
        if (exists.vue) {
            exec("npm run scss-vue", output("Scss (./dist/css/scss/)"));
        }
        if (exists.public || !exists.vue) {
            exec("npm run scss", output("Scss (./public/css/scss/)"));
        }
    }
};

if (!module.parent) module.exports();
