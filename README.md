# Unique Live NFT demo

Project to show how to create live NFTs in Unique network.

### System requirements

- Node.js LTS (tested on Node@18)
- System should meet the [canvas](https://www.npmjs.com/package/canvas) library requirements. Ubuntu is fine and Docker image node:18 is working too.

### Build and run

```bash
cp .example.env .env
npm install
```

And then edit the `.env` file.

You can just run it:

```bash
npx tsx src/index.ts
```

And optionally it can be built: 

```bash
npm run build
node dist/index.js
```

Works same with both start options, no significant work speed difference. 

### Startup params 

```
npx tsx src\index.ts
Usage: index [options]

Options:
  --createCollectionAndToken  Create new collection and mint a token and print out IDs.
  --update                    Update existing NFT. Requires COLLECTION_ID and TOKEN_ID env vars be set.
  --cron                      Starts task runner which will periodically update existing NFT.
                              Requires COLLECTION_ID and TOKEN_ID env vars be set.
  --testImage                 Test image generator. Just grabs the data from the API and generates image, that's all.
  -h, --help                  display help for command
```

Flag `--createCollectionAndToken` creates a collection, sets COLLECTION_ADMIN as collection admin, and then transfers the collection ownership to the OWNER_ADDRESS, and then mints an empty (!) token and prints out COLLECTION_ID and TOKEN_ID that should be added to the .env file. Important: at this stage the token is empty, to fill it you need to run the script with the `--update` flag.

Flag `--update` gets the data from the API, generates the image (`images/result.png`), uploads the image to the server, and then takes the COLLECTION_ID and TOKEN_ID from the environment variables, and updates the corresponding token in the chain, giving it the updated attributes and replacing the image link with a new image link.

Flag `--cron` runs the same task as the `--update` flag, but once every specified time interval (in .example.env, the example is for once every 15 minutes)

Flag `--testImage` gets data from the API and generates an image. No blockchain work is done.

### Licence

[MIT](https://opensource.org/licenses/MIT)
