import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import * as Generic from "./interfaces/Generic";
import { ucwords } from "./lib/string";
import { plural } from "pluralize";

const isNumber = require("is-number");

interface MDType {
    sql: string;
    js: string;
}

export enum MDDatabaseConflict {
    ROLLBACK,
    ABORT,
    FAIL,
    IGNORE,
    REPLACE
}

interface MDDatabaseOptions {
    unique_depth: number;
    type: Generic.Object<{
        check: string[];
        unique: {
            fields: string[];
            conflict: MDDatabaseConflict;
        }[];

        field: Generic.Object<{
            not_null: false | MDDatabaseConflict;
            check: string[];
            unique: false | MDDatabaseConflict;
            default: false | string;
        }>;
    }>;
}

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
                    marker = item;

                    return test(marker);
                })
            ) {
                return strip(marker);
            }

            return string[0];
        }

        if (test(string)) return string.substr(1, string.length - 2);

        return string;
    }
}

function getType(values: any[]): MDType {
    if (values.every(isNumber)) {
        if (values.length > 1 && values.every(is.boolean)) {
            return {
                sql: "INTEGER",
                js: "boolean"
            };
        }

        if (values.every(is.integer)) {
            return {
                sql: "INTEGER",
                js: "number"
            };
        }

        return {
            sql: "REAL",
            js: "number"
        };
    }

    return {
        sql: "TEXT",
        js: "string"
    };
}

function removeKeys(object: Record, keys: (keyof Record)[]) {
    keys.forEach(key => {
        delete object[key];
    });

    object.children.forEach(object => removeKeys(object, keys));

    return object;
}

function escape(name: string) {
    return name.replace(/\s|!|"|%|\^|&|\*|\(|\)|\[|\{|\]|\}|;|:|'|@|#|~|<|>|\.|\?|\/|\\|\||`|-|\+|=/gu, "_");
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

export class MDDatabase {
    data: Record[];
    md?: string;
    json: string;

    constructor(data: string | Record[]) {
        if (Array.isArray(data)) {
            this.data = data;
        } else {
            this.data = JSON.parse(data);
        }

        this.json = JSON.stringify(data, null, 4);
    }

    /* #region From Functions */
    static async fromFile(location: string | string[]): Promise<MDDatabase> {
        if (Array.isArray(location)) {
            let records = await Promise.all<MDDatabase>(location.map(MDDatabase.fromFile));

            return new MDDatabase(
                Array.prototype.concat.apply(
                    [],
                    records.map(record => record.data)
                )
            );
        }

        let file = await readFile(location, "utf-8");

        let type = (location.split(".").pop() || "").toLowerCase();
        switch (type) {
            case "md":
                return MDDatabase.fromMD(file);

            case "json":
                return new MDDatabase(file);

            default:
                throw new Error("Unsupported format.");
        }
    }

    static fromMD(md: string | string[]) {
        if (Array.isArray(md)) {
            return new MDDatabase(
                Array.prototype.concat.apply(
                    [],
                    md.map<MDDatabase>(MDDatabase.fromMD).map(data => data.data)
                )
            );
        }

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

        return new MDDatabase(feed.map(object => removeKeys(object, ["parent"])));
    }
    /* #endregion */

    /* #region Management Functions */
    getOptions(options: Partial<MDDatabaseOptions> = {}): MDDatabaseOptions {
        let final_options = Object.assign(
            {
                unique_depth: 0,
                type: {}
            },
            options || {}
        );

        if (typeof final_options.unique_depth !== "number") {
            final_options.unique_depth = 0;
        }

        if (typeof final_options.type !== "object") {
            final_options.type = {};
        }

        for (let type in final_options.type) {
            final_options.type[type] = Object.assign(
                {
                    unique: [],
                    check: [],
                    field: {}
                },
                final_options.type[type]
            );

            if (!Array.isArray(final_options.type[type].unique)) {
                final_options.type[type].unique = [];
            }

            if (!Array.isArray(final_options.type[type].check)) {
                final_options.type[type].check = [];
            }

            if (typeof final_options.type[type].field !== "object") {
                final_options.type[type].field = {};
            }

            for (let field in final_options.type[type].field) {
                final_options.type[type].field[field] = Object.assign(
                    {
                        not_null: false,
                        unique: false,
                        check: [],
                        default: false
                    },
                    final_options.type[type].field[field]
                );

                if (!Array.isArray(final_options.type[type].field[field].check)) {
                    final_options.type[type].field[field].check = [];
                }
            }
        }

        return final_options;
    }

    buildMaps(in_options: Partial<MDDatabaseOptions> = {}) {
        let flat = flatten(this.data);
        let type_to_table: Generic.Object<{
            columns: {
                field: string;
                property: string;
                required: boolean;
                type: MDType;
            }[];
            keys: string[];
            raw: Generic.Object<any[]>;
            insert: Record[];
            parent?: Record | false;
        }> = {};
        let name_to_record: Generic.Object<Record[]> = {};
        let name_to_properties: Generic.Object = {};
        let options = this.getOptions(in_options);

        /**
         * Looping through all objects
         */
        flat.forEach((object, object_i) => {
            let type_escape = escape(object.type);

            /* #region Collate objects with the same type to build table schema/inserts */
            if (!(type_escape in type_to_table)) {
                type_to_table[type_escape] = {
                    raw: {},
                    insert: [],
                    parent: false,
                    columns: [
                        {
                            field: `${type_escape}_uuid`,
                            property: "uuid",
                            type: {
                                sql: "TEXT",
                                js: "string"
                            },
                            required: true
                        }
                    ],
                    keys: []
                };
            }

            type_to_table[type_escape].insert.push(object);
            type_to_table[type_escape].parent = type_to_table[type_escape].parent || object.parent;

            for (let property in object.properties) {
                if (!(property in type_to_table[type_escape].raw)) {
                    type_to_table[type_escape].raw[property] = [];
                }
                type_to_table[type_escape].raw[property].push(object.properties[property]);
            }
            /* #endregion */

            /* #region Collate objects with the same name to merge properties and UUID */
            let unique = object.name + (object.depth <= options.unique_depth ? `_${object_i}` : "");
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
            /* #endregion */
        });

        /**
         * Looping through all object types to build table fields
         */
        Object.keys(type_to_table).forEach(type => {
            let parent = type_to_table[type].parent;
            if (parent) {
                type_to_table[type].keys.push(`PRIMARY KEY (\`${type}_${parent.type}_uuid\`, \`${type}_uuid\`)`);
            } else {
                type_to_table[type].keys.push(`PRIMARY KEY (\`${type}_uuid\`)`);
            }

            /**
             * Looping through all object type properties
             */
            Object.keys(type_to_table[type].raw).forEach(property => {
                if (marker.test(type_to_table[type].raw[property])) {
                    let name = marker.strip(type_to_table[type].raw[property]);
                    if (!(name in name_to_record && name_to_record[name].length)) {
                        throw new Error(`Unable to find reference "${ucwords(name)}"`);
                    }

                    type_to_table[type].columns.unshift({
                        field: escape(`${type}_${property}_${name_to_record[name][0].type}_uuid`),
                        property: property,
                        type: {
                            sql: "TEXT",
                            js: "string"
                        },
                        required: false
                    });
                    type_to_table[type].keys.push(
                        `FOREIGN KEY (\`${type_to_table[type].columns[0].field}\`) REFERENCES \`${plural(
                            escape(name_to_record[name][0].type)
                        )}\` (\`${escape(name_to_record[name][0].type)}_uuid\`)`
                    );
                } else {
                    let format = getType(type_to_table[type].raw[property]);

                    type_to_table[type].columns.push({
                        required: false,
                        field: `${type}_${escape(property)}`,
                        property: property,
                        type: format
                    });
                }
            });

            if (parent) {
                let parent_type_escape = escape(parent.type);

                type_to_table[type].insert.forEach(object => {
                    if (object.parent) {
                        object.properties._parent = object.parent.properties.uuid;
                    }
                });

                type_to_table[type].columns.unshift({
                    field: `${type}_${parent_type_escape}_uuid`,
                    property: "_parent",
                    type: {
                        sql: "TEXT",
                        js: "string"
                    },
                    required: true
                });
                type_to_table[type].keys.splice(
                    1,
                    0,
                    `FOREIGN KEY (\`${type}_${parent_type_escape}_uuid\`) REFERENCES \`${plural(
                        parent_type_escape
                    )}\` (\`${parent_type_escape}_uuid\`)`
                );
            }

            if (type in options.type) {
                options.type[type].check.forEach(check => {
                    type_to_table[type].keys.push(`CHECK (${check})`);
                });

                options.type[type].unique.forEach(unique => {
                    unique.fields = unique.fields.map(field => {
                        if (
                            !type_to_table[type].columns.some(column => {
                                if (field === column.property) field = column.field;

                                return field === column.field;
                            })
                        ) {
                            throw new Error(`Unknown field: "${field}"`);
                        }

                        return field;
                    });

                    type_to_table[type].keys.push(
                        `UNIQUE (\`${unique.fields.join("`, `")}\`) ON CONFLICT ${MDDatabaseConflict[unique.conflict]}`
                    );
                });
            }
        });

        return {
            flat,
            type_to_table,
            name_to_record
        };
    }

    cleanFlat(flat: Record[]) {
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
    }
    /* #endregion */

    /* #region To Functions */
    async toFile(location: string, options: Partial<MDDatabaseOptions> = {}) {
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
                content = this.toSQL(options);
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

    toSQL(in_options: Partial<MDDatabaseOptions> = {}) {
        let options = this.getOptions(in_options);
        let { flat, type_to_table, name_to_record } = this.buildMaps(in_options);

        let sql = Object.keys(type_to_table)
            .reverse()
            .map(type => {
                return `DROP TABLE IF EXISTS \`${plural(type)}\`;`;
            })
            .concat(
                Object.keys(type_to_table).map(type => {
                    return `CREATE TABLE IF NOT EXISTS \`${plural(type)}\` (
    ${type_to_table[type].columns
        .map(column => {
            let field = `\`${column.field}\` ${column.type.sql}`;

            if (type in options.type && column.property in options.type[type].field) {
                let { not_null, unique, check, default: _default } = options.type[type].field[column.property];

                if (not_null) field += ` NOT NULL ON CONFLICT ${MDDatabaseConflict[not_null]}`;

                if (check.length) field += ` CHECK (${check.join(") CHECK (")})`;

                if (unique) field += ` UNIQUE ON CONFLICT ${MDDatabaseConflict[unique]}`;

                if (_default) field += ` DEFAULT ${_default}`;
            }

            return field;
        })
        .join(",\n    ")},

    ${type_to_table[type].keys.join(",\n    ")}
);`;
                })
            )
            .concat(
                Object.keys(type_to_table).map(type => {
                    return `INSERT INTO \`${plural(type)}\`
    (${type_to_table[type].columns.map(column => `\`${column.field}\``).join(", ")}) VALUES
    ${type_to_table[type].insert
        .map(record => {
            return `(${type_to_table[type].columns
                .map(column => {
                    if (record.properties[column.property]) {
                        if (marker.test(record.properties[column.property])) {
                            let name = marker.strip(record.properties[column.property]);
                            if (!(name in name_to_record && name_to_record[name].length)) {
                                throw new Error(`Unable to find reference "${ucwords(name)}"`);
                            }

                            return `"${name_to_record[name][0].properties.uuid}"`;
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
        .join(",\n    ")};`;
                })
            )
            .join("\n\n");

        this.cleanFlat(flat);

        return sql;
    }

    toTS() {
        let { flat, type_to_table } = this.buildMaps();

        let ts = `class MDDatabaseClass<Properties> {
    data: Properties;
    
    constructor(properties: Properties) {
        this.data = properties;
    }
}

${Object.keys(type_to_table)
    .map(type => {
        return `export namespace ${ucwords(type.split("_").join(" ")).split(" ").join("")} {
    export interface Object {
        ${type_to_table[type].columns
            .map(column => `${column.field + (column.required ? "" : "?")}: ${column.type.js}`)
            .join(";\n        ")};
    }

    export class Instance extends MDDatabaseClass<Object> {}`;
    })
    .join("\n}\n\n")}
}
`;

        this.cleanFlat(flat);

        return ts;
    }
    /* #endregion */
}
