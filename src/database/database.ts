"use strict";

import "reflect-metadata";

import { MongoClient } from "mongodb";
import { injectable, inject } from "inversify";
import { IDatabase, ISettings } from "../interfaces"

import assert = require("assert");
import { WorkerInfo } from "../model/worker_info";
import { WorkspaceInfo } from "../model/workspace_info";
import { JobInfo } from "../model/job_info";
import { VraySpawnerInfo } from "../model/vray_spawner_info";
import { ApiKey } from "./model/api_key";
import { IDbEntity } from "./model/base/IDbEntity";
import { Workspace } from "./model/workspace";
import { Session } from "./model/session";
import { Worker } from "./model/worker";
import { TYPES } from "../types";

const uuidv4 = require('uuid/v4');

@injectable()
class Database implements IDatabase {
    private _url: String;
    private _client: MongoClient;

    private _settings: ISettings;

    constructor(@inject(TYPES.ISettings) settings: ISettings) 
    {
        this._settings = settings;
    }

    private envCollectionName(name: string) {
        return `${this._settings.current.collectionPrefix}-${name}`;
    }

    connect(url: string): Promise<any> {
        this._url = url;
        this._client = new MongoClient(url, { useNewUrlParser: true });

        return new Promise(function(resolve, reject) {
            this._client.connect()
                .then(resolve)
                .catch(reject);
        }.bind(this));
    }

    create(): Promise<any> {
        return new Promise<any>(async function(resolve, reject) {
            try {
                let db = this._client.db(this._settings.current.databaseName);
                assert.notEqual(db, null);

                let collections = await db.listCollections().toArray();

                let users = this.envCollectionName("users"); 
                if (!collections.find(e => e.name === users)) {
                    await db.createCollection(users);
                }

                let apiKeys = this.envCollectionName("api-keys");
                if (!collections.find(e => e.name === apiKeys)) {
                    await db.createCollection(apiKeys);
                }

                let sessions = this.envCollectionName("sessions");
                if (!collections.find(e => e.name === sessions)) {
                    await db.createCollection(sessions);
                }

                let workspaces = this.envCollectionName("workspaces");
                if (!collections.find(e => e.name === workspaces)) {
                    await db.createCollection(workspaces);
                }

                let workers = this.envCollectionName("workers");
                if (!collections.find(e => e.name === workers)) {
                    await db.createCollection(workers);
                }

                let vraySpawners = this.envCollectionName("vray-spawners");
                if (!collections.find(e => e.name === vraySpawners)) {
                    await db.createCollection(vraySpawners);
                }

                let jobs = this.envCollectionName("jobs");
                if (!collections.find(e => e.name === jobs)) {
                    await db.createCollection(jobs);
                }

                resolve();
            } catch (exc) {
                reject(exc);
            }
        }.bind(this));
    }

    getOne<T extends IDbEntity>(collection: string, filter: any, setter: any, ctor: (obj: any) => T): Promise<T> {
        return new Promise<T>(function(resolve, reject) {
            let db = this._client.db(this._settings.current.databaseName);
            assert.notEqual(db, null);
    
            db.collection(collection).findOneAndUpdate(
                filter,
                { $set: setter },
                { returnOriginal: false })
                .then(function(obj){
                    if (obj.ok === 1 && obj.value) {
                        resolve(ctor(obj));
                    } else {
                        reject(`nothing was filtered from ${collection} by ${JSON.stringify(filter)}`);
                    }
                }.bind(this))
                .catch(function(err){
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    insertOne<T extends IDbEntity>(collection: string, entity: IDbEntity, ctor: (obj: any) => T): Promise<T> {
        return new Promise<T>(function(resolve, reject) {
            let db = this._client.db(this._settings.current.databaseName);
            assert.notEqual(db, null);

            db.collection(collection).insertOne(entity.toJSON())
                .then(function(obj){
                    if (obj.result.ok === 1 && obj.insertedCount === 1) {
                        resolve(ctor(obj.ops[0]));
                    } else {
                        reject(`failed to insert in ${collection}`);
                    }
                }.bind(this))
                .catch(function(err){
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    updateOne<T extends IDbEntity>(collection: string, filter: any, setter: any, ctor: (obj: any) => T): Promise<T> {
        return new Promise<T>(function(resolve, reject) {
            let db = this._client.db(this._settings.current.databaseName);
            assert.notEqual(db, null);

            db.collection(collection).findOneAndUpdate(
                filter, // like { apiKey: apiKey }
                setter,
                { returnOriginal: false })
                .then(function(obj){
                    if (obj.ok === 1 && obj.value) {
                        resolve(ctor(obj.value));
                    } else {
                        reject(`nothing was filtered from ${collection} by ${JSON.stringify(filter)}`);
                    }
                }.bind(this))
                .catch(function(err){
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    updateMany<T extends IDbEntity>(collection: string, filter: any, setter: any, ctor: (obj: any) => T): Promise<T[]> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        let trans = uuidv4();
        setter.$set._trans = trans; //remember transaction
        return new Promise<T[]>(function (resolve, reject) {
            db.collection(collection).updateMany(
                filter,
                setter)
                .then(function(value){
                    if (value.matchedCount > 0 && value.modifiedCount > 0) {
                        // query updated documents with given transaction
                        db.collection(collection).find({ _trans: trans })
                            .toArray()
                            .then(function(value){
                                let updated = value.map(e => ctor(e));
                                resolve(updated);
                            }.bind(this))
                            .catch(function(err){
                                reject(err);
                            }.bind(this));
                    } else {
                        resolve([]);
                    }
                }.bind(this))
                .catch(function(err){
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    getApiKey(apiKey: string): Promise<ApiKey> {
        return this.getOne<ApiKey>(
            "api-keys", 
            { apiKey: apiKey },
            { lastSeen: new Date() },
            (obj) => new ApiKey(obj));
    }

    getWorkspace(workspaceGuid: string): Promise<Workspace> {
        return this.getOne<Workspace>(
            "workspaces", 
            { guid: workspaceGuid, workgroup: this._settings.current.workgroup },
            { lastSeen: new Date() },
            (obj) => new Workspace(obj));
    }

    getSession(sessionGuid: string): Promise<Session> {
        return this.getOne<Session>(
            "sessions", 
            { guid: sessionGuid, closed: { $ne: true } },
            { lastSeen: new Date() },
            (obj) => new Session(obj));
    }

    expireSessions(olderThanMinutes: number): Promise<Session[]> {
        let expirationDate = new Date(Date.now() - olderThanMinutes * 60*1000);
        let filter = { 
            lastSeen : { $lte: expirationDate },
            closed: { $exists: false }
        };
        let setter = { $set: { closed: true, closedAt: new Date(), abandoned: true } };
        return this.updateMany<Session>("sessions", filter, setter, obj => new Session(obj));
    }

    // assign free worker to given session
    createSession(apiKey: string, workspace: string): Promise<Session> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<Session>(function (resolve, reject) {

            // pick only the workers who were seen not less than 2 seconds ago
            let recentOnlineDate = new Date(Date.now() - 2 * 1000);
            db.collection(this.envCollectionName("workers")).find({ 
                workgroup: { $eq: this._settings.current.workgroup },
                lastSeen : { $gte: recentOnlineDate },
                sessionGuid: { $exists: false }
            }).sort({
                cpuUsage: 1
            }).toArray()
                .then(async function(availableWorkers){
                    // now we have not busy workers ordered by cpu load, we can pick one from top
                    let workers: Worker[] = availableWorkers.map(e => new Worker(e));

                    // this will prevent multiple worker assignment, if top most worker was set busy = true,
                    // then we just pick underlying least loaded worker.
                    for(let wi in workers) {
                        try {
                            let filter: any = { 
                                workgroup: this._settings.current.workgroup,
                                lastSeen : { $gte: recentOnlineDate },
                                sessionGuid: { $exists: false },
                                endpoint: workers[wi].endpoint,
                                mac: workers[wi].mac
                            };
                            let sessionGuid = uuidv4();
                            let setter: any = { $set: { sessionGuid: sessionGuid } };

                            let self = this as IDatabase;
                            let caputuredWorker = await self.updateOne<Worker>("workers", filter, setter, (obj: any) => new Worker(obj));

                            let session = new Session(null);
                            session.apiKey = apiKey;
                            session.guid = sessionGuid;
                            session.firstSeen = new Date();
                            session.lastSeen = session.firstSeen;
                            session.workerEndpoint = caputuredWorker.endpoint;
                            session.workspaceGuid = workspace;

                            let createdSession = await self.insertOne<Session>("sessions", session, obj => new Session(obj));

                            resolve(createdSession);
                            return;
                        }
                        catch (err) {
                            // ignore it, just try with another worker
                        }
                    }

                    reject("all workers busy");

                }.bind(this))
                .catch(function(err){
                    reject(err);
                }.bind(this));

        }.bind(this)); // return this promise
    }

    async storeWorker(workerInfo: WorkerInfo): Promise<WorkerInfo> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        let workerJson = workerInfo.toDatabase();

        return new Promise<WorkerInfo>(function (resolve, reject) {
            db.collection(this.envCollectionName("workers")).findOneAndUpdate(
                { mac: workerInfo.mac, port: workerInfo.port },
                { $set: workerJson },
                { returnOriginal: false, upsert: true })
                .then(function(obj) {
                    if (obj.value) {
                        resolve(WorkerInfo.fromJSON(obj.value));
                    } else {
                        reject(`unable to find worker with mac ${workerInfo.mac} and port ${workerInfo.port}`);
                    }
                }.bind(this))
                .catch(function(err) {
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    // find worker assigned to given session
    async getWorker(sessionGuid: string): Promise<WorkerInfo> {

        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<WorkerInfo>(function (resolve, reject) {
            if (sessionGuid === undefined || sessionGuid === "" || sessionGuid === null) {
                reject("getWorker: session id is empty");
            }

            // first find not closed sessions, and join each with corresponding workers
            db.collection(this.envCollectionName("sessions")).aggregate([
                {
                    $match: {
                        guid: sessionGuid
                    }
                },
                {
                    $lookup:
                      {
                        from: "workers",
                        localField: "workerEndpoint",
                        foreignField: "endpoint",
                        as: "worker"
                      }
                },
                { 
                    $unwind : "$worker" 
                }
            ]).toArray(async function(err, res) {
                if (err) {
                    console.error(err);
                    reject(`getWorker: failed to find worker by session guid: ${sessionGuid}`);
                    return;
                }

                if (res.length > 1) {
                    console.error(`getWorker: found more than one session with guid: ${sessionGuid}`);
                }

                if (res.length === 0) {
                    console.log(`getWorker: session not found: ${sessionGuid}`);
                    resolve(undefined);
                }

                await db.collection(this.envCollectionName("sessions")).updateOne(
                    { guid: sessionGuid },
                    { $set: { lastSeen : new Date() } });

                let worker = WorkerInfo.fromJSON(res[0].worker);
                console.log(`getWorker: found a worker for session ${sessionGuid}: ${JSON.stringify(worker)}`);
                resolve(worker);
            }.bind(this));
        }.bind(this));
    }

    async deleteDeadWorkers(): Promise<number> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<number>(function (resolve, reject) {
            let expirationDate = new Date(Date.now() - 30*60*1000); // delete workers that are more than 30 minutes offline

            db.collection(this.envCollectionName("workers")).deleteMany(
                { 
                    lastSeen : { $lte: expirationDate }
                })
                .then(function(value){
                    if (value && value.deletedCount > 0) {
                        resolve(value.deletedCount);
                    } else {
                        resolve(0);
                    }
                }.bind(this))
                .catch(function(err){
                    reject(err);
                }.bind(this)); // end of db.collection(this.envCollectionName("workers").deleteMany promise
        }.bind(this));
    }

    async storeVraySpawner(vraySpawnerInfo: VraySpawnerInfo): Promise<VraySpawnerInfo> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        let vraySpawnerJson = vraySpawnerInfo.toDatabase();
        // console.log(" >> vraySpawnerJson: ", vraySpawnerJson);

        return new Promise<VraySpawnerInfo>(function (resolve, reject) {
            db.collection(this.envCollectionName("vray-spawners")).findOneAndUpdate(
                { mac: vraySpawnerInfo.mac, ip: vraySpawnerInfo.ip },
                { $set: vraySpawnerJson },
                { returnOriginal: false, upsert: true })
                .then(function(obj) {
                    if (obj.value) {
                        // console.log(" >> obj.value: ", obj.value);
                        resolve(VraySpawnerInfo.fromJSON(obj.value));
                    } else {
                        reject(`unable to find vray spawner with mac ${vraySpawnerInfo.mac} and ip ${vraySpawnerInfo.ip}`);
                    }
                }.bind(this))
                .catch(function(err) {
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    async assignSessionWorkspace(sessionGuid: string, workspaceGuid: string): Promise<boolean> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<boolean>(function (resolve, reject) {

            db.collection(this.envCollectionName("sessions")).findOneAndUpdate(
                { guid : sessionGuid },
                { $set: { workspaceGuid: workspaceGuid, lastSeen : new Date() } },
                { returnOriginal: false })
                .then(function(obj) {
                    if (obj.value) {
                        resolve(true);
                    } else {
                        reject(`unable to find session with guid ${sessionGuid}`);
                    }
                }.bind(this))
                .catch(function(err) {
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    async getSessionWorkspace(sessionGuid: string): Promise<WorkspaceInfo> {

        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<WorkspaceInfo>(function (resolve, reject) {
            if (sessionGuid === undefined || sessionGuid === "" || sessionGuid === null) {
                reject("getSessionWorkspace: session id is empty");
            }

            // first find not closed sessions, and join each with corresponding workspace
            db.collection(this.envCollectionName("sessions")).aggregate([
                {
                    $match: {
                        guid: sessionGuid
                    }
                },
                {
                    $lookup:
                      {
                        from: "workspaces",
                        localField: "workspaceGuid",
                        foreignField: "guid",
                        as: "workspace"
                      }
                },
                { 
                    $unwind : "$workspace" 
                }
            ]).toArray(async function(err, res) {
                if (err) {
                    console.error(err);
                    reject(`getSessionWorkspace: failed to find workspace by session guid: ${sessionGuid}`);
                    return;
                }

                if (res.length > 1) {
                    console.error(`getSessionWorkspace: found more than one session with guid: ${sessionGuid}`);
                }

                if (res.length === 0) {
                    console.log(`getSessionWorkspace: session not found: ${sessionGuid}`);
                    resolve(undefined);
                }

                //todo: extract to method touchSession(guid)
                await db.collection(this.envCollectionName("sessions")).updateOne(
                    { guid: sessionGuid },
                    { $set: { lastSeen : new Date() } });

                //todo: extract to method touchWorkspace(guid)
                await db.collection(this.envCollectionName("workspaces")).updateOne(
                    { guid: res[0].workspace.guid },
                    { $set: { lastSeen : new Date() } });
                
                let workspace = WorkspaceInfo.fromJSON(res[0].workspace);
                console.log(`getSessionWorkspace: found a workspace for session ${sessionGuid}: ${JSON.stringify(workspace)}`);
                resolve(workspace);
            }.bind(this));
        }.bind(this));
    }

    async closeSession(sessionGuid: string): Promise<boolean> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<boolean>(function (resolve, reject) {

            db.collection(this.envCollectionName("sessions")).findOneAndUpdate(
                { guid : sessionGuid },
                { $set: { closed: true, closedAt: new Date() } },
                { returnOriginal: false })
                .then(function(obj) {
                    if (obj.value) {
                        resolve(true);
                    } else {
                        reject(`unable to find session with guid ${sessionGuid}`);
                    }
                }.bind(this))
                .catch(function(err) {
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    //todo: this method is not tested
    async storeJob(jobInfo: JobInfo): Promise<JobInfo> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        let jobJson = jobInfo.toDatabase();

        return new Promise<JobInfo>(function (resolve, reject) {
            db.collection(this.envCollectionName("jobs")).findOneAndUpdate(
                { guid: jobInfo.guid },
                { $set: jobJson },
                { returnOriginal: false, upsert: true })
                .then(function(obj) {
                    if (obj.value) {
                        resolve(WorkerInfo.fromJSON(obj.value));
                    } else {
                        reject(`unable to find job with guid ${jobInfo.guid}`);
                    }
                }.bind(this))
                .catch(function(err) {
                    reject(err);
                }.bind(this));
        }.bind(this));
    }

    //todo: this method is not tested
    async getJob(jobGuid: string): Promise<JobInfo> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<JobInfo>(function (resolve, reject) {
            db.collection(this.envCollectionName("jobs")).findOne(
                { 
                    guid: jobGuid
                })
                .then(function(obj) {
                    if (obj) {
                        let jobInfo = JobInfo.fromJSON(obj);
                        resolve(jobInfo);
                    } else {
                        reject(`unable to find job with guid ${jobGuid}`);
                    }
                }.bind(this))
                .catch(function(err) {
                    console.error(err);
                    reject(`failed to query available workers`);
                    return
                }.bind(this)); // end of db.collection(this.envCollectionName("jobs").findOne promise
        }.bind(this));
    }

    //todo: we need to kill pending and running jobs when session is expired or closed
    async getSessionActiveJobs(sessionGuid: string): Promise<JobInfo[]> {
        let db = this._client.db(this._settings.current.databaseName);
        assert.notEqual(db, null);

        return new Promise<JobInfo[]>(function (resolve, reject) {
            //todo: implement it
        }.bind(this));
    };
}

export { Database };
