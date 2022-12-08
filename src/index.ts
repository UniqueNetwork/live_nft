/*
MIT License

Copyright 2022 Unique Network

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import {program} from 'commander'
import * as dotenv from 'dotenv'
import assert from 'assert'

import {Sdk} from '@unique-nft/sdk'
import {KeyringProvider} from '@unique-nft/accounts/keyring'
import {Address} from '@unique-nft/utils'

import {createCanvas, loadImage, registerFont} from 'canvas'
import axios from 'axios'
import {promises as fs} from 'fs'
import {CronJob} from 'cron'
import { formatInTimeZone } from 'date-fns-tz'
import localeEn from 'date-fns/locale/en-GB'

import * as plural from 'plural-ru'

dotenv.config()

const getStringEnvVar = (name: string): string => {
  const value = process.env[name]
  assert(typeof value === 'string', `env var ${name} should be set`)
  return value
}

const getIntEnvVar = (name: string): number => {
  const value = parseInt(getStringEnvVar(name))
  assert(!isNaN(value), `env var ${name} should be valid integer number`)
  return value
}

const splitStringToGroupsOf3 = (str: string): string[] =>
  str.split('').reverse().join('')
    .match(/.{1,3}/g)!
    .map(s => s.split('').reverse().join(''))
    .reverse()

/////////////////////////////////////////////////////
// External API data requester
/////////////////////////////////////////////////////

interface IData {
  param: number
}

const getData = async (apiToken: string, apiUrl: string): Promise<IData> => {
  const [response] = await Promise.all([
    axios({
      method: 'get',
      url: apiUrl,
      headers: {
        'Authorization': `Bearer ${apiToken}`
      }
    }),
  ])

  const result = {
    ...response.data
  } as any

  assert(typeof result.param === 'number', 'Data from API is not valid')

  return result as IData
}

const DataToPropertyMap: { [K in keyof IData]: string } = {
  param: 'a.0',
}

/////////////////////////////////////////////////////
// Image generator
/////////////////////////////////////////////////////


const generateAndSaveResultImage = async (data: IData, filesDir: string, imagesDir: string) => {
  const image = await loadImage(`${filesDir}/template.png`)
  registerFont(`${filesDir}/Rubik-Medium.ttf`, {family: 'Rubik', weight: 'Medium'})

  const canvas = createCanvas(image.width, image.height)

  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  ctx.font = '36px Rubik Medium'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'right'

  ctx.fillText(data.param.toString(), 980, 250)

  const buffer = canvas.toBuffer('image/png')

  try {
    await fs.stat(imagesDir)
  } catch {
    await fs.mkdir(imagesDir)
  }

  await fs.writeFile(`${imagesDir}/result.png`, buffer)

  console.log(`Image generated, file size: ${buffer.byteLength} bytes`)

  return buffer
}


/////////////////////////////////////////////////////
// Test the image generator
/////////////////////////////////////////////////////

const testImageGeneration = async () => {
  const apiToken = getStringEnvVar('API_KEY')
  const apiUrl = getStringEnvVar('API_URL')
  const imagesDir = getStringEnvVar('OUTPUT_IMAGES_DIR')

  //get new data
  const data = await getData(apiUrl, apiToken)
  console.log('New data from the API:')
  console.dir(data)

  // generate new image for the token
  await generateAndSaveResultImage(data, 'files', imagesDir)
}

/////////////////////////////////////////////////////
// Token data updater
/////////////////////////////////////////////////////

const updateTheTokenWithTheNewImage = async () => {
  console.log('Starting token updating process...')

  const apiToken = getStringEnvVar('API_KEY')
  const apiUrl = getStringEnvVar('API_URL')

  const mnemonic = getStringEnvVar('COLLECTION_ADMIN_MNEMONIC')
  const sdkRestUrl = getStringEnvVar('SDK_REST_URL')
  const sdkRestUrlForIPFS = typeof process.env.SDK_REST_URL_FOR_IPFS === 'string'
    ? getStringEnvVar('SDK_REST_URL_FOR_IPFS')
    : sdkRestUrl
  const imagesDir = getStringEnvVar('OUTPUT_IMAGES_DIR')

  const collectionId = getIntEnvVar('COLLECTION_ID')
  const tokenId = getIntEnvVar('TOKEN_ID')

  const account = await KeyringProvider.fromMnemonic(mnemonic)
  const address = account.getAddress()

  const sdk = new Sdk({baseUrl: sdkRestUrl, signer: account})
  const specialSdkInstanceForIPFS = new Sdk({baseUrl: sdkRestUrlForIPFS})

  const balance = await sdk.balance.get({address})
  const balanceValueBefore = parseFloat(balance.availableBalance.amount)
  console.log(`Admin address is ${address}, admin balance is ${balanceValueBefore.toFixed(3)} ${balance.availableBalance.unit}`)

  // ensure that we can update the token
  const admins = (await sdk.collections.admins({collectionId}))
    .admins
    .map(adminInAnyForm => Address.extract.addressNormalized(adminInAnyForm))
  assert(admins.find(adminAddress => adminAddress === address), `COLLECTION_ADMIN_MNEMONIC's address ${address} is not found in collection admins`)

  assert(balanceValueBefore > 1, `Balance of the ${address} account is lower then 1`)

  //get new data
  const data = await getData(apiToken, apiUrl)

  // generate new image for the token
  const file = await generateAndSaveResultImage(data, 'files', imagesDir)

  // update the image
  const ipfsUploadResult = await specialSdkInstanceForIPFS.ipfs.uploadFile({file})
  // console.log(ipfsUploadResult)

  // update the token itself
  const formattedDateTime = formatInTimeZone(new Date(), 'UTC', `d MMMM yyyy HH:mm:ss`, {locale: localeEn})

  const tokenUpdateResult = await sdk.tokens.setProperties.submitWaitResult({
    address,
    collectionId,
    tokenId,
    properties: [
      {key: DataToPropertyMap.param, value: `{"_": "${data.param}"}`},
      {key: 'a.1', value: `{"_": "${formattedDateTime}"}`},
      {key: 'i.i', value: ipfsUploadResult.cid}
    ]
  })

  if (!tokenUpdateResult.isCompleted) {
    throw tokenUpdateResult.error
  }
  const balanceDataAfter = await sdk.balance.get({address})
  const balanceAfter = parseFloat((balanceDataAfter).availableBalance.amount)
  const diff = (balanceValueBefore - balanceAfter).toFixed(3)
  console.log(`Token ${collectionId}/${tokenId} has been successfully updated, it took ${diff} ${balanceDataAfter.availableBalance.unit}`)
}

/////////////////////////////////////////////////////
// Cron job starter
/////////////////////////////////////////////////////

const runCronJob = async () => {
  const cronTime = getStringEnvVar('CRON_TIME')

  const job = new CronJob({
    cronTime,
    onTick: async function () {
      await new Promise(r => setTimeout(r, 500))
      console.log('Starting task on cron:', formatInTimeZone(new Date(), 'Europe/Moscow', `HH:mm:ss dd.MM.yyyy 'MSK'`), `next job at`, job.nextDate().toFormat(`HH:mm:ss dd.MM.yyyy 'MSK'`))

      await updateTheTokenWithTheNewImage()

      console.log('Next cron job is at', job.nextDate().toFormat(`HH:mm:ss dd.MM.yyyy 'MSK'`), '\n')
    },
    runOnInit: true,
  })

  job.start()
}


/////////////////////////////////////////////////////
// Create collection and dummy token placeholder
/////////////////////////////////////////////////////

const createCollectionAndToken = async () => {
  const mnemonic = getStringEnvVar('COLLECTION_ADMIN_MNEMONIC')
  const ownerAddress = Address.extract.addressNormalized(getStringEnvVar('OWNER_ADDRESS'))
  const sdkRestUrl = getStringEnvVar('SDK_REST_URL')

  const account = await KeyringProvider.fromMnemonic(mnemonic)
  const address = account.getAddress()

  const sdk = new Sdk({
    baseUrl: sdkRestUrl,
    signer: account
  })

  const balance = await sdk.balance.get({address})
  const balanceValue = parseFloat(balance.availableBalance.amount)
  console.log(`Admin address is ${address}, admin balance is ${balanceValue.toFixed(3)} ${balance.availableBalance.unit}`)

  assert(balanceValue > 3, `BALANCE SHOULD BE GREATER THAN ${3}`)

  const PERMISSION_ALL_TRUE = {mutable: true, collectionAdmin: true, tokenOwner: true}

  const collectionResult = await sdk.collections.creation.submitWaitResult({
    address,
    name: 'Live NFT',
    description: 'Live NFT collection',
    tokenPrefix: 'LIVE',
    schema: {
      schemaName: 'unique',
      schemaVersion: '1.0.0',
      image: {
        urlTemplate: `https://ipfs.unique.network/ipfs/{infix}`
      },
      coverPicture: {
        url: `https://ipfs.unique.network/ipfs/QmPCqY7Lmxerm8cLKmB18kT1RxkwnpasPVksA8XLhViVT7`
      },
      attributesSchemaVersion: '1.0.0',
      attributesSchema: {
        0: {
          name: {_: 'param'},
          type: 'string', isArray: false, optional: false,
        },
        1: {
          name: {_: 'Updated at'},
          type: 'string', isArray: false, optional: false,
        },
      }
    },
    tokenPropertyPermissions: [
      {key: 'i.u', permission: PERMISSION_ALL_TRUE},
      {key: 'i.c', permission: PERMISSION_ALL_TRUE},
      {key: 'i.i', permission: PERMISSION_ALL_TRUE},
      {key: 'i.h', permission: PERMISSION_ALL_TRUE},
      {key: 'n', permission: PERMISSION_ALL_TRUE},
      {key: 'd', permission: PERMISSION_ALL_TRUE},
      {key: 'a.0', permission: PERMISSION_ALL_TRUE},
      {key: 'a.1', permission: PERMISSION_ALL_TRUE},
    ]
  })


  const collectionId = collectionResult.parsed?.collectionId!
  assert(typeof collectionId === 'number', collectionResult.error?.toString())


  await sdk.collections.addAdmin.submitWaitResult({
    address,
    collectionId,
    newAdmin: address,
  })

  await sdk.collections.transfer.submitWaitResult({
    address,
    collectionId,
    to: ownerAddress,
  })

  const tokenResult = await sdk.tokens.create.submitWaitResult({
    address,
    owner: ownerAddress,
    collectionId,
  })

  const tokenId = tokenResult.parsed?.tokenId!
  assert(typeof tokenId === 'number', tokenResult.error?.toString())

  console.log('\nCollection created and empty token has been minted.\nPlease, add this env vars to the .env file or env vault:\n')
  console.log(`COLLECTION_ID=${collectionId}`)
  console.log(`TOKEN_ID=${tokenId}`)
  console.log('\n')
}

program
  .option('--createCollectionAndToken', 'Create new collection and mint a token and print out IDs.')
  .option('--update', 'Update existing NFT. Requires COLLECTION_ID and TOKEN_ID env vars be set.')
  .option('--cron', 'Starts task runner which will periodically update existing NFT. Requires COLLECTION_ID and TOKEN_ID env vars be set.')
  .option('--testImage', `Test image generator. Just grabs the data from the API and generates image, that's all.`)

program.parse()

const options = program.opts()

const run = async () => {
  if (options.testImage) {
    await testImageGeneration()
  } else if (options.createCollectionAndToken) {
    await createCollectionAndToken()
  } else if (options.update) {
    await updateTheTokenWithTheNewImage()
  } else if (options.cron) {
    await runCronJob()
  } else {
    program.help()
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
