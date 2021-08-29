import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import * as Generic from "./interfaces/Generic";
import { ucwords } from "./lib/string";

namespace is {
    export function date(value: any) {
        let date = new Date(value);

        return numeric(date.getMonth()) && date.getFullYear() > 1970;
    }

    export function numeric(value: any) {
        return !Number.isNaN(parseFloat(value));
    }

    export function number(value: any) {
        return numeric(value) && !date(value) && !String(value).includes("-");
    }

    export function integer(value: any) {
        return parseFloat(value) === parseInt(value);
    }
}

namespace marker {
    export function test(string: string) {
        return /^{.+?}$/.test(string);
    }

    export function strip(string: string) {
        if (test(string)) {
            string = string.substr(1, string.length - 2);
        }

        return string;
    }
}

function removeKeys(object: Record, keys: (keyof Record)[]) {
    keys.forEach(key => {
        delete object[key];
    });

    object.children.forEach(object => removeKeys(object, keys));

    return object;
}

function mdFlatten(object: Record): string {
    let flatten = [`${"#".repeat(object.depth)} ${ucwords(object.name)} (${object.type})`];

    if (Object.keys(object.properties).length) {
        flatten.push(
            Object.keys(object.properties)
                .map(property => {
                    let value = object.properties[property];

                    if (marker.test(value)) {
                        value = `{${ucwords(marker.strip(object.properties[property]))}}`;
                    }

                    return `-   ${ucwords(property)}: ${value}`;
                })
                .join("\n")
        );
    }

    return flatten.concat(object.children.map(mdFlatten).join("\n\n")).join("\n\n").trim();
}

interface Record {
    parent?: Record | false;
    children: Record[];
    name: string;
    depth: number;
    type: string;
    properties: Generic.Object;
}

function sqlFlatten(
    objects: Record[] | Record,
    unique_depth: number,
    flat: Record[] = [],
    is_base = true
): string | void {
    /* #region Flatten all Record(s) into "flat" array */
    if (Array.isArray(objects)) {
        objects.forEach(object => sqlFlatten(object, unique_depth, flat, false));
    } else {
        flat.push(objects);

        objects.children.forEach(child => {
            child.parent = objects;

            sqlFlatten(child, unique_depth, flat, false);
        });
    }
    /* #endregion */

    if (is_base) {
        let schema: string[] = [];
        let inserts: string[] = [];
        let type_to_table: Generic.Object<{
            raw: Generic.Object;
            insert: Record[];
            parent?: Record | false;
        }> = {};
        let name_to_record: Generic.Object<Record[]> = {};
        let name_to_properties: Generic.Object = {};

        /**
         * Looping through all objects
         */
        flat.forEach((object, object_i) => {
            /* #region Collate objects with the same type to build table schema/inserts */
            if (object.type in type_to_table) {
                type_to_table[object.type].raw = Object.assign(type_to_table[object.type].raw, object.properties);

                type_to_table[object.type].insert.push(object);
            } else {
                type_to_table[object.type] = {
                    raw: Object.assign({}, object.properties),
                    insert: [object],
                    parent: object.parent
                };
            }
            /* #endregion */

            /* #region Collate objects with the same name to merge properties and UUID */
            let unique = object.name + (object.depth <= unique_depth ? `_${object_i}` : "");
            if (!(unique in name_to_record)) {
                name_to_record[unique] = [];
                name_to_properties[unique] = {
                    uuid: randomUUID()
                };
            }

            object.properties = JSON.parse(
                JSON.stringify(Object.assign(name_to_properties[unique], object.properties))
            );

            name_to_record[unique].push(object);

            flat.push(object);
            /* #endregion */
        });

        /**
         * Looping through all object types to build table fields
         */
        Object.keys(type_to_table).forEach(type => {
            let columns = [
                {
                    field: `\`${type}_uuid\``,
                    property: "uuid",
                    type: "TEXT"
                }
            ];
            let keys = [];
            let parent = type_to_table[type].parent;
            if (parent) {
                keys.push(`PRIMARY KEY (\`${type}_${parent.type}_uuid\`, \`${type}_uuid\`)`);
            } else {
                keys.push(`PRIMARY KEY (\`${type}_uuid\`)`);
            }

            /**
             * Looping through all object type properties
             */
            Object.keys(type_to_table[type].raw).forEach(property => {
                if (marker.test(type_to_table[type].raw[property])) {
                    let marker_type = name_to_record[marker.strip(type_to_table[type].raw[property])][0].type;

                    columns.unshift({
                        field: `\`${type}_${property}_uuid\``,
                        property: property,
                        type: "TEXT"
                    });
                    keys.push(
                        `FOREIGN KEY (\`${type}_${property}_uuid\`) REFERENCES \`${marker_type}s\` (\`${marker_type}_uuid\`)`
                    );
                } else {
                    let format = "TEXT";
                    if (is.number(type_to_table[type].raw[property])) {
                        if (is.integer(type_to_table[type].raw[property])) {
                            format = "INTEGER";
                        } else {
                            format = "REAL";
                        }
                    }

                    columns.push({
                        field: `\`${type}_${property}\``,
                        property: property,
                        type: format
                    });
                }
            });

            if (parent) {
                type_to_table[type].insert.forEach(object => {
                    if (object.parent) {
                        object.properties._parent = object.parent.properties.uuid;
                    }
                });

                columns.unshift({
                    field: `\`${type}_${parent.type}_uuid\``,
                    property: "_parent",
                    type: "TEXT"
                });
                keys.splice(
                    1,
                    0,
                    `FOREIGN KEY (\`${type}_${parent.type}_uuid\`) REFERENCES \`${parent.type}s\` (\`${parent.type}_uuid\`)`
                );
            }

            schema.push(
                `CREATE TABLE IF NOT EXISTS \`${type}s\` (\n\t${columns
                    .map(column => {
                        return `${column.field} ${column.type}`;
                    })
                    .join(",\n\t")},\n\n\t${keys.join(",\n\t")}\n);`
            );

            if (type_to_table[type].insert.length) {
                inserts.push(
                    `INSERT INTO \`${type}s\`\n\t(${columns.map(column => column.field).join(", ")}) VALUES\n\t` +
                        type_to_table[type].insert
                            .map(record => {
                                return `(${columns
                                    .map(column => {
                                        if (record.properties[column.property]) {
                                            if (marker.test(record.properties[column.property])) {
                                                return `"${
                                                    name_to_record[marker.strip(record.properties[column.property])][0]
                                                        .properties.uuid
                                                }"`;
                                            }

                                            if (is.number(record.properties[column.property])) {
                                                return record.properties[column.property];
                                            }

                                            return `"${record.properties[column.property]}"`;
                                        }

                                        return "NULL";
                                    })
                                    .join(", ")})`;
                            })
                            .join(",\n\t") +
                        ";"
                );
            }
        });

        /**
         * Delete properties to prevent circular references
         */
        flat.forEach(object => {
            if (object.parent) {
                delete object.parent;
            }

            delete object.properties.uuid;
            delete object.properties._parent;
        });

        return schema.concat(inserts).join("\n\n");
    }
}

export class MDData {
    data: Record[];
    md?: string;
    json: string;

    constructor(data: string | Record[]) {
        if (Array.isArray(data)) {
            this.data = data;
            this.json = JSON.stringify(this.data);
        } else {
            this.json = data;
            this.data = JSON.parse(data);
        }
    }

    /* #region From Functions */
    static async fromFile(location: string) {
        let file = await readFile(location, "utf-8");

        let type = (location.split(".").pop() || "").toLowerCase();
        switch (type) {
            case "md":
                return MDData.fromMD(file);

            case "json":
                return new MDData(file);

            default:
                throw new Error("Unsupported format.");
        }
    }

    static fromMD(md: string) {
        let lines = md.split("\n");
        let feed: Record[] = [];
        let previous: Record | false = false;
        let current: Record;

        lines.forEach(line => {
            line = line.trim();

            let depth = line.match(/^(?<depth>#{1,}\s)(?<name>.+?)($|\((?<type>.+?)\))/);
            if (depth && depth.groups) {
                if (!depth.groups.type) {
                    throw new Error(`Unknown type for "${depth.groups.name.trim()}"`);
                }

                current = {
                    depth: depth.groups.depth.length - 1,
                    name: depth.groups.name.trim().toLowerCase(),
                    type: depth.groups.type.trim().toLowerCase(),
                    children: [],
                    properties: {},
                    parent: previous
                };

                if (current.depth === 1) {
                    feed.push(current);
                } else if (current.parent) {
                    if (current.depth === current.parent.depth) {
                        current.parent = current.parent.parent;
                    } else if (current.depth < current.parent.depth && current.parent.parent) {
                        current.parent = current.parent.parent.parent;
                    }

                    if (
                        current.parent &&
                        !current.parent.children.some(child => {
                            if (child.name === current.name) {
                                current = child;

                                return true;
                            }

                            return false;
                        })
                    ) {
                        current.parent.children.push(current);
                    }
                }

                previous = current;
            } else if (previous) {
                let data = line.match(/^(-\s{3})?(?<property>.+?): (?<value>.+)/i);
                if (data && data.groups) {
                    let value = data.groups.value.trim();

                    if (marker.test(value)) value = value.toLowerCase();

                    previous.properties[data.groups.property.toLowerCase()] = value;
                }
            }
        });

        return new MDData(feed.map(object => removeKeys(object, ["parent"])));
    }
    /* #endregion */

    /* #region To Functions */
    async toFile(location: string, unique_depth?: number) {
        let type = (location.split(".").pop() || "").toLowerCase();
        switch (type) {
            case "md":
                return await writeFile(location, this.toMD());

            case "json":
                return await writeFile(location, this.toJSON());

            case "sql":
                return await writeFile(location, this.toSQL(unique_depth || 1));

            default:
                throw new Error("Unsupported format.");
        }
    }

    toJSON() {
        return this.json;
    }

    toMD() {
        if (!this.md) {
            this.md = this.data.map(mdFlatten).join("\n\n").trim() + "\n";
        }

        return this.md;
    }

    toSQL(unique_depth: number) {
        return sqlFlatten(this.data, unique_depth) || "";
    }
    /* #endregion */
}
