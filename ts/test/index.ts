import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { MDDatabase } from "..";

async function test() {
    let readme = await readFile(join(__dirname, "..", "..", "ts", "test", "README.md"), "utf-8");

    let md1 = await readFile(join(__dirname, "..", "..", "ts", "test", "test.md"), "utf-8");

    let schema = MDDatabase.fromMD(md1);

    let md2 = await schema.toFile(join(__dirname, "test (copy).md"));

    let json = await schema.toFile(join(__dirname, "test.json"));

    let sql = await schema.toFile(join(__dirname, "test.sql"));

    let ts = await schema.toFile(join(__dirname, "test.ts"));

    await writeFile(
        join(__dirname, "..", "..", "README.md"),
        readme
            .replace("<MD1>", md1)
            .replace("<MD2>", md2)
            .replace("<JSON>", JSON.stringify(JSON.parse(json), null, 4))
            .replace("<SQL>", sql)
            .replace("<TS>", ts)
    );
}

test();
