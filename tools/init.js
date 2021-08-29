const child_process = require("child_process");

function exec(command) {
    return new Promise(resolve => {
        return child_process.exec(command, resolve);
    });
}

module.exports = async () => {
    await exec("npm run clone");

    for (let i = 2; i < process.argv.length; i += 1) {
        await exec(`npm run ${process.argv[i]}-init`);
    }

    await exec("npm run clone-clean");
};

if (!module.parent) module.exports();
