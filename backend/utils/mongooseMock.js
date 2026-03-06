// A simple in-memory mock for Mongoose models to ensure functionality without a real MongoDB service
class MockModel {
    constructor(name, schema) {
        this.name = name;
        this.schema = schema;
        this.data = new Map();
    }

    async findOne(query) {
        for (const item of this.data.values()) {
            if (Object.keys(query).every(key => item[key] === query[key])) {
                return item;
            }
        }
        return null;
    }

    async findById(id) {
        return this.data.get(id.toString()) || null;
    }

    async find(query) {
        const results = [];
        for (const item of this.data.values()) {
            if (Object.keys(query).every(key => item[key] === query[key])) {
                results.push(item);
            }
        }
        return results;
    }

    createModelInstance(obj) {
        const id = obj._id || Math.random().toString(36).substring(7);
        const instance = {
            ...obj,
            _id: id,
            save: async () => {
                this.data.set(id.toString(), instance);
                return instance;
            }
        };
        return instance;
    }
}

const mockStore = {
    Room: new MockModel('Room'),
    Message: new MockModel('Message')
};

module.exports = {
    model: (name) => {
        const mock = mockStore[name];
        const res = function (data) { return mock.createModelInstance(data); };
        res.findOne = mock.findOne.bind(mock);
        res.findById = mock.findById.bind(mock);
        res.find = mock.find.bind(mock);
        return res;
    },
    Schema: class {
        index() { /* Dummy for mock */ }
    },
    connect: async () => { console.log('📁 Using Mocked In-Memory Database'); return true; }
};
