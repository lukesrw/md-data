export function ucwords(words: string) {
    return words
        .split(" ")
        .map(word => {
            return word.substr(0, 1).toUpperCase() + word.substr(1);
        })
        .join(" ");
}
