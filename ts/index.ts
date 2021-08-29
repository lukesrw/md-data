import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import * as Generic from "./interfaces/Generic";
import { ucwords } from "./lib/string";

const isNumber = require("is-number");

namespace is {
    export function date(value: any) {
        let date = new Date(value);

        return numeric(date.getMonth()) && date.getFullYear() > 1970;
    }

    export function numeric(value: any) {
        return !Number.isNaN(parseFloat(value));
    }

    export function integer(value: any) {
        return parseFloat(value) === parseInt(value);
    }

    export function boolean(value: any) {
        return [0, 1].includes(parseInt(value));
    }
}

namespace marker {
    export function test(string: string | string[]) {
        if (Array.isArray(string)) return string.some(test);

        return /^{.+?}$/.test(string);
    }

    export function strip(string: string | string[]): string {
        if (Array.isArray(string)) {
            let marker = "";

            if (
                string.some(item => {
                    if (test(item)) {
                        marker = item;

                        return true;
                    }

                    return false;
                })
            ) {
                return strip(marker);
            }

            return string[0];
        }

        if (test(string)) {
            return string.substr(1, string.length - 2);
        }

        return string;
    }
}

function getType(values: any[], for_database = false) {
    if (values.every(isNumber)) {
        if (values.length > 1 && values.every(is.boolean)) {
            return for_database ? "INTEGER" : "boolean";
        }

        if (for_database && values.every(is.integer)) {
            return for_database ? "INTEGER" : "number";
        }

        return for_database ? "REAL" : "number";
    }

    return for_database ? "TEXT" : "string";
}

function removeKeys(object: Record, keys: (keyof Record)[]) {
    keys.forEach(key => {
        delete object[key];
    });

    object.children.forEach(object => removeKeys(object, keys));

    return object;
}

function escapeProperty(name: string) {
    return name.replace(/\s/gu, "_");
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

function flatten(objects: Record[] | Record, flat: Record[] = []) {
    if (Array.isArray(objects)) {
        objects.forEach(object => flatten(object, flat));
    } else {
        flat.push(objects);

        objects.children.forEach(object => {
            object.parent = objects;

            flatten(object, flat);
        });
    }

    return flat;
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
        let content;

        switch (type) {
            case "md":
                content = this.toMD();
                break;

            case "json":
                content = this.toJSON();
                break;

            case "sql":
                content = this.toSQL(unique_depth || 0);
                break;

            case "ts":
                content = this.toTS();
                break;

            default:
                throw new Error("Unsupported format.");
        }

        await writeFile(location, content);

        return content;
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
        let flat = flatten(this.data);
        let schema: string[] = [];
        let inserts: string[] = [];
        let type_to_table: Generic.Object<{
            raw: Generic.Object<any[]>;
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
            if (!(object.type in type_to_table)) {
                type_to_table[object.type] = {
                    raw: {},
                    insert: [],
                    parent: false
                };
            }

            type_to_table[object.type].insert.push(object);
            type_to_table[object.type].parent = type_to_table[object.type].parent || object.parent;

            for (let property in object.properties) {
                if (!(property in type_to_table[object.type].raw)) {
                    type_to_table[object.type].raw[property] = [];
                }
                type_to_table[object.type].raw[property].push(object.properties[property]);
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
                        field: `\`${type}_${escapeProperty(property)}_uuid\``,
                        property: property,
                        type: "TEXT"
                    });
                    keys.push(
                        `FOREIGN KEY (\`${type}_${property}_uuid\`) REFERENCES \`${marker_type}s\` (\`${marker_type}_uuid\`)`
                    );
                } else {
                    let format = getType(type_to_table[type].raw[property], true);

                    columns.push({
                        field: `\`${type}_${escapeProperty(property)}\``,
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

                                            if (isNumber(record.properties[column.property])) {
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

    toTS() {
        let objects = flatten(this.data);
        let type_to_properties: Generic.Object<
            Generic.Object<{
                values: any[];
                required: boolean;
                type: string;
            }>
        > = {};

        objects.forEach(object => {
            if (!(object.type in type_to_properties)) {
                type_to_properties[object.type] = {
                    [`${object.type}_uuid`]: {
                        values: [""],
                        required: true,
                        type: "string"
                    }
                };

                if (object.parent) {
                    type_to_properties[object.type][`${object.type}_${object.parent.type}_uuid`] = {
                        values: [""],
                        required: true,
                        type: "string"
                    };
                }
            }

            for (let property in object.properties) {
                let property_escaped = escapeProperty(property);
                let property_name = `${object.type}_${property_escaped}`;

                if (!(property in type_to_properties[object.type])) {
                    type_to_properties[object.type][property_name] = {
                        values: [],
                        required: false,
                        type: "string"
                    };
                }
                type_to_properties[object.type][property_name].values.push(object.properties[property as keyof Record]);
            }
        });

        for (let type in type_to_properties) {
            for (let property in type_to_properties[type]) {
                type_to_properties[type][property].type = getType(type_to_properties[type][property].values);
            }
        }

        return `class MDDataClass<Properties> {
    data: Properties;
    
    constructor(properties: Properties) {
        this.data = properties;
    }
}

${Object.keys(type_to_properties)
    .map(type => {
        return `export namespace ${ucwords(type)} {
    export interface Object {
        ${Object.keys(type_to_properties[type])
            .map(property => {
                let property_name = property;
                if (!type_to_properties[type][property].required) {
                    property_name += "?";
                }

                return `${property_name}: ${type_to_properties[type][property].type}`;
            })
            .join(";\n\t\t")};
    }

    export class Instance extends MDDataClass<Object> {}`;
    })
    .join("\n}\n\n")}\n}
`;
    }
    /* #endregion */
}
